import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { StorageService } from '../../../lib/storage.service';
import { ImportsRepo } from '../repositories/imports.repo';
import { authenticateRest } from '../../../lib/rest-auth';
import { attachmentDisposition } from '../../../lib/download-headers';
import { rowsToCsv } from '../../../lib/csv';
import { canAccessImport } from '../controller';

const storageService = new StorageService();
const importsRepo = new ImportsRepo();

/**
 * History page (spec §17) downloads that don't fit tRPC's JSON transport:
 * the retained original upload, and a generated CSV of skipped rows with
 * their reasons. Same bearer-token-only pattern as exports-download.route.ts
 * — session tokens never travel in the query string.
 */
const importsDownloadRoute: FastifyPluginCallback = (fastify, _, done) => {
  fastify.get('/download/:id/source', async (req: FastifyRequest, reply) => {
    const authResult = await authenticateRest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const { id } = req.params as { id: string };
    const importRecord = await importsRepo.getOneWithStats({ tenant_id: authResult.auth.tenant_id, id });

    if (!importRecord) {
      return reply.status(404).send({ error: 'Import not found' });
    }
    // SECURITY: the lookup above is scoped to the tenant only, and `data_imports.id` is a sequence
    // value, so a member could walk the ids and download every contact list the workspace has ever
    // uploaded. The exports download route closed this same hole with the same rule; apply it here
    // from the one shared predicate.
    if (!canAccessImport(importRecord, authResult.auth)) {
      return reply.status(403).send({ error: 'You can only download your own imports.' });
    }
    if (!importRecord.source_file_key) {
      return reply.status(404).send({ error: 'The original file is no longer available for this import.' });
    }

    try {
      const buffer = await storageService.download(importRecord.source_file_key);
      reply.type('text/csv; charset=utf-8');
      reply.header('Content-Disposition', attachmentDisposition(importRecord.file_name));
      return reply.send(buffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to stream the original import file' });
    }
  });

  fastify.get('/download/:id/skipped', async (req: FastifyRequest, reply) => {
    const authResult = await authenticateRest(req);
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const { id } = req.params as { id: string };
    const importRecord = await importsRepo.getOneWithStats({ tenant_id: authResult.auth.tenant_id, id });

    if (!importRecord) {
      return reply.status(404).send({ error: 'Import not found' });
    }
    // Same rule as the source download above: the skipped-rows CSV carries the email address of
    // every row that did not load, which is the same contact data by another route.
    if (!canAccessImport(importRecord, authResult.auth)) {
      return reply.status(403).send({ error: 'You can only download your own imports.' });
    }
    if (!importRecord.skip_reasons.length) {
      return reply.status(404).send({ error: 'No skipped rows recorded for this import.' });
    }

    const csv = rowsToCsv(importRecord.skip_reasons, ['row', 'email', 'reason']);
    reply.type('text/csv; charset=utf-8');
    reply.header(
      'Content-Disposition',
      attachmentDisposition(`${importRecord.file_name.replace(/\.csv$/i, '')}-skipped-rows.csv`),
    );
    return reply.send(csv);
  });

  done();
};

export default importsDownloadRoute;
