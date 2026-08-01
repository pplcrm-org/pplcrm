import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { StorageService } from '../../../lib/storage.service';
import { ExportsRepo } from '../repositories/exports.repo';
import { authenticateRest } from '../../../lib/rest-auth';
import { attachmentDisposition } from '../../../lib/download-headers';
import { canAccessExport } from '../controller';

const storageService = new StorageService();
const exportsRepo = new ExportsRepo();

const exportsDownloadRoute: FastifyPluginCallback = (fastify, _, done) => {
  fastify.get('/download/:id', async (req: FastifyRequest, reply) => {
    // Authorization header only — session JWTs in the query string are
    // deliberately not accepted because URLs leak into history and logs.
    const authResult = await authenticateRest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const { id } = req.params as { id: string };
    const exportRecord = await exportsRepo.getById(id, authResult.auth.tenant_id);

    if (!exportRecord) {
      return reply.status(404).send({ error: 'Export not found' });
    }
    // SECURITY: the lookup above is scoped to the tenant only, and `data_exports.id` is a
    // sequence value, so a member could walk the ids and download a colleague's CSV. The delete
    // path already required ownership or a privileged role; apply the same rule here, from the
    // one shared predicate.
    if (!canAccessExport(exportRecord, authResult.auth)) {
      return reply.status(403).send({ error: 'You can only download your own exports.' });
    }
    if (exportRecord.status !== 'completed') {
      return reply.status(409).send({ error: 'Export is not ready yet' });
    }
    if (!exportRecord.storage_key) {
      return reply.status(404).send({ error: 'Export file not available' });
    }

    try {
      const buffer = await storageService.download(exportRecord.storage_key);
      reply.type('text/csv; charset=utf-8');
      reply.header('Content-Disposition', attachmentDisposition(exportRecord.file_name));
      return reply.send(buffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to stream export file' });
    }
  });

  done();
};

export default exportsDownloadRoute;
