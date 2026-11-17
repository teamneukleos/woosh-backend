import "dotenv/config";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { resolve } from "path";
import { Prisma, PrismaClient, ProspectStatus, SocialChannel } from "@prisma/client";
import {
  discoveryHasPreviewMedia,
  metricsFromDiscovery,
  type GraphDiscovery,
} from "./instagram-graph-metrics";

const JOB_ID = "instagram-graph-enrich";

const DISCOVERY_FIELDS =
  "business_discovery.username({handle}){id,username,name,biography,followers_count,media_count,profile_picture_url,website,media.limit(25){id,caption,like_count,comments_count,view_count,play_count,media_type,media_product_type,timestamp,permalink,media_url,thumbnail_url}}";

function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function isRateLimited(status: number, body: { error?: { code?: number; message?: string } }) {
  const code = body.error?.code;
  const message = (body.error?.message ?? "").toLowerCase();
  return (
    status === 429 ||
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 ||
    message.includes("rate limit") ||
    message.includes("too many calls") ||
    message.includes("request limit")
  );
}

function graphUrl(igUserId: string, handle: string, token: string, version: string) {
  const params = new URLSearchParams({
    fields: DISCOVERY_FIELDS.replace("{handle}", handle),
    access_token: token,
  });
  return `https://graph.facebook.com/${version}/${igUserId}?${params.toString()}`;
}

async function fetchDiscovery(input: {
  igUserId: string;
  handle: string;
  token: string;
  version: string;
}) {
  const res = await fetch(graphUrl(input.igUserId, input.handle, input.token, input.version));
  const body = (await res.json()) as {
    business_discovery?: GraphDiscovery;
    error?: { code?: number; message?: string; type?: string };
  };
  return { status: res.status, body };
}

async function main() {
  const csvPath = resolve(
    process.env.META_GRAPH_CSV?.trim() ||
      "../woosh/public/instagram-500k-seed-table.csv",
  );
  const igUserId = process.env.META_IG_USER_ID?.trim();
  const token = process.env.META_IG_USER_ACCESS_TOKEN?.trim();
  const version = process.env.META_GRAPH_VERSION?.trim() || "v26.0";
  const limit = Number(process.env.META_GRAPH_LIMIT ?? "200");
  const delayMs = Number(process.env.META_GRAPH_DELAY_MS ?? "400");
  const reset = process.argv.includes("--reset");
  const retryErrors = process.argv.includes("--retry-errors");

  if (!igUserId || !token) {
    throw new Error(
      "Set META_IG_USER_ID and META_IG_USER_ACCESS_TOKEN (the Graph Explorer user token that worked for business_discovery).",
    );
  }

  const prisma = new PrismaClient();
  const cursor = reset
    ? await prisma.jobCursor.upsert({
        where: { id: JOB_ID },
        create: { id: JOB_ID, lineOffset: 0, status: "running" },
        update: { lineOffset: 0, lastHandle: null, status: "running", lastError: null },
      })
    : await prisma.jobCursor.upsert({
        where: { id: JOB_ID },
        create: { id: JOB_ID, lineOffset: 0, status: "running" },
        update: { status: "running", lastError: null },
      });

  let skip = cursor.lineOffset;
  let processed = 0;
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  let dataRow = 0;
  let stoppedForRateLimit = false;
  let lastHandle: string | null = cursor.lastHandle;
  let lastError: string | null = null;

  const rl = createInterface({
    input: createReadStream(csvPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  try {
    for await (const raw of rl) {
      if (stoppedForRateLimit || processed >= limit) break;
      const line = raw.replace(/^\uFEFF/, "");
      if (!line.trim()) continue;
      if (dataRow === 0 && line.toLowerCase().startsWith("handle,")) continue;

      dataRow += 1;
      if (dataRow <= skip) continue;

      const [handleCell, , nigeriaSignal] = parseCsvLine(line);
      const handle = normalizeHandle(handleCell ?? "");
      if (!handle) {
        skip = dataRow;
        continue;
      }
      lastHandle = handle;

      const existing = await prisma.creatorProspect.findUnique({
        where: { channel_handle: { channel: SocialChannel.INSTAGRAM, handle } },
        select: { graphStatus: true, status: true, engagementRate: true, graphPayload: true },
      });
      if (existing?.status === ProspectStatus.CLAIMED) {
        skipped += 1;
        skip = dataRow;
        processed += 1;
        continue;
      }
      if (
        existing?.graphStatus === "ok" &&
        existing.engagementRate != null &&
        discoveryHasPreviewMedia(existing.graphPayload as GraphDiscovery)
      ) {
        skipped += 1;
        skip = dataRow;
        processed += 1;
        continue;
      }
      if (existing?.graphStatus === "error" && !retryErrors) {
        skipped += 1;
        skip = dataRow;
        processed += 1;
        continue;
      }

      const { status, body } = await fetchDiscovery({
        igUserId,
        handle,
        token,
        version,
      });

      if (isRateLimited(status, body)) {
        stoppedForRateLimit = true;
        lastError = body.error?.message ?? "Graph rate limit";
        break;
      }

      const discovery = body.business_discovery;
      if (!discovery?.username && body.error) {
        await prisma.creatorProspect.upsert({
          where: { channel_handle: { channel: SocialChannel.INSTAGRAM, handle } },
          create: {
            channel: SocialChannel.INSTAGRAM,
            handle,
            locationCountry: nigeriaSignal?.toLowerCase() === "yes" ? "NG" : undefined,
            graphStatus: "error",
            graphFetchedAt: new Date(),
            graphPayload: body as Prisma.InputJsonValue,
          },
          update: {
            graphStatus: "error",
            graphFetchedAt: new Date(),
            graphPayload: body as Prisma.InputJsonValue,
          },
        });
        failed += 1;
      } else if (discovery) {
        const metrics = metricsFromDiscovery(discovery);
        const locationCountry =
          nigeriaSignal?.toLowerCase() === "yes" ? "NG" : undefined;
        const record = {
          displayName: discovery.name || discovery.username || handle,
          locationCountry,
          followerEstimate: discovery.followers_count ?? undefined,
          avatarUrl: discovery.profile_picture_url ?? undefined,
          biography: discovery.biography ?? undefined,
          website: discovery.website ?? undefined,
          mediaCount: discovery.media_count ?? undefined,
          engagementRate: metrics.engagementRate ?? undefined,
          averageLikes: metrics.averageLikes ?? undefined,
          averageComments: metrics.averageComments ?? undefined,
          averageViews: metrics.averageViews ?? undefined,
          metricSampleSize: metrics.sampleSize,
          graphStatus: "ok",
          graphFetchedAt: new Date(),
          graphPayload: discovery as Prisma.InputJsonValue,
        };
        await prisma.creatorProspect.upsert({
          where: { channel_handle: { channel: SocialChannel.INSTAGRAM, handle } },
          create: {
            channel: SocialChannel.INSTAGRAM,
            handle: normalizeHandle(discovery.username ?? handle),
            status: ProspectStatus.UNCLAIMED,
            ...record,
          },
          update: record,
        });
        saved += 1;
      } else {
        failed += 1;
      }

      skip = dataRow;
      processed += 1;
      if (delayMs > 0) {
        await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
      }
    }

    const done = !stoppedForRateLimit && processed < limit;
    await prisma.jobCursor.update({
      where: { id: JOB_ID },
      data: {
        lineOffset: skip,
        lastHandle,
        status: stoppedForRateLimit ? "rate_limited" : done ? "done" : "idle",
        lastError,
      },
    });
  } finally {
    rl.close();
    await prisma.$disconnect();
  }

  console.log(
    JSON.stringify(
      {
        csvPath,
        lineOffset: skip,
        lastHandle,
        processed,
        saved,
        skipped,
        failed,
        stoppedForRateLimit,
        lastError,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
