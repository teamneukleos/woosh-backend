import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinancialDocumentType } from '@prisma/client';
import { canAccessFinancialDocument } from '../common/payments-policy';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import { presentMoney } from './present';
import { renderFinancialDocumentPdf } from './pdf';

function presentDocument(document: {
  id: string;
  documentNumber: string;
  type: FinancialDocumentType;
  currency: string;
  grossAmount: { toNumber?: () => number } | number;
  feeAmount: { toNumber?: () => number } | number;
  netAmount: { toNumber?: () => number } | number;
  generatedAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  snapshot: unknown;
}) {
  return {
    id: document.id,
    documentNumber: document.documentNumber,
    type: document.type,
    currency: document.currency,
    grossAmount: presentMoney(document.grossAmount),
    feeAmount: presentMoney(document.feeAmount),
    netAmount: presentMoney(document.netAmount),
    generatedAt: document.generatedAt,
    periodStart: document.periodStart,
    periodEnd: document.periodEnd,
    snapshot: document.snapshot,
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async listCreator(creatorProfileId: string) {
    const rows = await this.prisma.financialDocument.findMany({
      where: { creatorProfileId },
      orderBy: { generatedAt: 'desc' },
      take: 50,
    });
    return rows.map(presentDocument);
  }

  async listBrand(userId: string, brandId: string) {
    await this.workspace.requireBrandAccess(userId, brandId);
    const rows = await this.prisma.financialDocument.findMany({
      where: { brandId },
      orderBy: { generatedAt: 'desc' },
      take: 50,
    });
    return rows.map(presentDocument);
  }

  async getForActor(documentId: string, userId: string) {
    const [actor, document] = await Promise.all([
      this.workspace.getWorkActor(userId),
      this.prisma.financialDocument.findUnique({ where: { id: documentId } }),
    ]);
    if (!document) throw new NotFoundException('Document not found.');
    const allowed = canAccessFinancialDocument({
      isPlatformAdmin: actor.isPlatformAdmin,
      actorCreatorProfileId: actor.creatorProfileId,
      actorBrandIds: actor.brandIds,
      documentCreatorProfileId: document.creatorProfileId,
      documentBrandId: document.brandId,
    });
    if (!allowed) throw new ForbiddenException('You cannot access this document.');
    return presentDocument(document);
  }

  async pdfForActor(documentId: string, userId: string) {
    const document = await this.getForActor(documentId, userId);
    const bytes = await renderFinancialDocumentPdf(document);
    return { bytes, documentNumber: document.documentNumber };
  }

  async createCreatorStatement(
    creatorProfileId: string,
    year: number,
    month: number,
  ) {
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 1));
    const obligations = await this.prisma.paymentObligation.findMany({
      where: {
        participant: { creatorProfileId },
        status: 'PAID',
        paidAt: { gte: periodStart, lt: periodEnd },
      },
      include: {
        participant: {
          include: {
            creator: { select: { displayName: true } },
            campaign: { include: { brand: { select: { name: true } } } },
          },
        },
      },
      orderBy: { paidAt: 'asc' },
    });

    const creator = await this.prisma.creatorProfile.findUnique({
      where: { id: creatorProfileId },
      select: { displayName: true },
    });
    if (!creator) throw new NotFoundException('Creator profile not found.');

    const gross = obligations.reduce(
      (sum, row) => sum + presentMoney(row.grossAmount),
      0,
    );
    const fee = obligations.reduce(
      (sum, row) => sum + presentMoney(row.platformFee),
      0,
    );
    const net = obligations.reduce(
      (sum, row) => sum + presentMoney(row.netAmount),
      0,
    );
    const currency = obligations[0]?.currency ?? 'NGN';
    const periodKey = `${year}${String(month).padStart(2, '0')}`;
    const suffix = creatorProfileId.slice(-6).toUpperCase();
    const dedupeKey = `statement:${creatorProfileId}:${periodKey}`;

    const snapshot = {
      year,
      month,
      creator: creator.displayName,
      lines: obligations.map((row) => ({
        date: row.paidAt?.toISOString() ?? null,
        campaign: row.participant.campaign.title,
        brand: row.participant.campaign.brand.name,
        gross: presentMoney(row.grossAmount),
        fee: presentMoney(row.platformFee),
        net: presentMoney(row.netAmount),
        currency: row.currency,
      })),
    };

    const document = await this.prisma.financialDocument.upsert({
      where: { dedupeKey },
      create: {
        documentNumber: `WO-STMT-${periodKey}-${suffix}`,
        type: FinancialDocumentType.CREATOR_STATEMENT,
        creatorProfileId,
        periodStart,
        periodEnd,
        currency,
        grossAmount: gross,
        feeAmount: fee,
        netAmount: net,
        dedupeKey,
        snapshot,
      },
      update: {
        currency,
        grossAmount: gross,
        feeAmount: fee,
        netAmount: net,
        snapshot,
        generatedAt: new Date(),
      },
    });
    return presentDocument(document);
  }
}
