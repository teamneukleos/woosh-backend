import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { frontendOrigin } from '../common/socket.adapter';
import { CampaignAccessService } from './access.service';

export type RealtimeMessagePayload = {
  conversationId: string;
  message: {
    id: string;
    body: string;
    isSystem: boolean;
    senderUserId: string | null;
    createdAt: Date;
    readAt: Date | null;
  };
};

@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: frontendOrigin(), credentials: true },
})
export class MessagingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly access: CampaignAccessService,
  ) {}

  async handleConnection(client: Socket) {
    const token = this.tokenFrom(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      if (!payload.sub) {
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data.userId) {
      this.logger.debug(`socket disconnected ${client.data.userId}`);
    }
  }

  @SubscribeMessage('conversation:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: unknown,
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || typeof conversationId !== 'string' || conversationId.length > 64) {
      return { ok: false };
    }
    await this.access.requireConversationAccess(conversationId, userId);
    await client.join(`conversation:${conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('conversation:leave')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: unknown,
  ) {
    if (typeof conversationId !== 'string') return { ok: false };
    await client.leave(`conversation:${conversationId}`);
    return { ok: true };
  }

  emitMessage(payload: RealtimeMessagePayload) {
    this.server
      .to(`conversation:${payload.conversationId}`)
      .emit('message.new', payload);
  }

  private tokenFrom(client: Socket) {
    const auth = client.handshake.auth as { token?: unknown };
    if (typeof auth?.token === 'string' && auth.token.trim()) {
      return auth.token.trim();
    }
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7).trim();
    }
    return null;
  }
}
