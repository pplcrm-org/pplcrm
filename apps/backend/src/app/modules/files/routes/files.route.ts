import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { StorageService } from '../../../lib/storage.service';
import { BaseRepository } from '../../../lib/base.repo';
import { authenticateRest } from '../../../lib/rest-auth';
import { verifyFileDownloadToken } from '../../../lib/signed-download';
import { attachmentDisposition } from '../../../lib/download-headers';

const storageService = new StorageService();

interface FileDownloadRoute {
  Params: { id: string };
  Querystring: { st?: string };
}

const filesRoute: FastifyPluginCallback = (fastify, _, done) => {
  fastify.get('/download/:id', async (req: FastifyRequest<FileDownloadRoute>, reply) => {
    const { id } = req.params;

    // Authenticate via the Authorization header (app-initiated downloads) or
    // a short-lived token scoped to this one file (avatar <img> URLs).
    // Session JWTs in the query string are deliberately not accepted — URLs
    // leak into browser history, proxies, and logs.
    let tenantId: string | null = null;
    if (req.query.st) {
      // Short-lived token scoped to this one file (avatar <img> URLs).
      try {
        tenantId = verifyFileDownloadToken(req.query.st, String(id)).tenant_id;
      } catch (_err) {
        return reply.status(401).send({ error: 'Unauthorized: Invalid token' });
      }
    } else {
      // App-initiated download via the Authorization header — session-gated.
      const authResult = await authenticateRest(req);
      if (!authResult.ok) {
        return reply.status(authResult.status).send({ error: authResult.error });
      }
      tenantId = authResult.auth.tenant_id;
    }

    if (!tenantId) {
      return reply.status(401).send({ error: 'Unauthorized: Missing token' });
    }

    const db = BaseRepository.dbInstance;

    const file = await db
      .selectFrom('files')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!file) {
      return reply.status(404).send({ error: 'File not found' });
    }

    try {
      const { stream, contentLength } = await storageService.downloadStream(file.storage_key);
      reply.type(file.mime_type || 'application/octet-stream');
      reply.header('Content-Disposition', attachmentDisposition(file.filename));
      if (contentLength != null) {
        reply.header('Content-Length', contentLength);
      }
      // Private: these files are tenant-scoped and token-gated — never allow shared caches.
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      return reply.send(stream);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to download file' });
    }
  });

  done();
};

export default filesRoute;
