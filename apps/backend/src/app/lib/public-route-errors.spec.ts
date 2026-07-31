import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { BadRequestError, NotFoundError, UnauthorizedError } from '../errors/app-errors';
import { publicClientMessageOf, publicMessageOf } from './public-route-errors';

const FALLBACK = 'Unable to load this turf.';

describe('publicMessageOf', () => {
  it('returns the fallback for a plain Error (e.g. a raw Postgres/Kysely error)', () => {
    const dbError = new Error('insert or update on table "turf_knocks" violates foreign key constraint "fk_tenant"');
    expect(publicMessageOf(dbError, FALLBACK)).toBe(FALLBACK);
  });

  it('returns the fallback for a TypeError', () => {
    expect(publicMessageOf(new TypeError("Cannot read properties of undefined (reading 'id')"), FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it('returns the fallback for non-Error throws', () => {
    expect(publicMessageOf('boom', FALLBACK)).toBe(FALLBACK);
    expect(publicMessageOf(undefined, FALLBACK)).toBe(FALLBACK);
    expect(publicMessageOf({ message: 'not an Error instance' }, FALLBACK)).toBe(FALLBACK);
  });

  it('passes through AppError subclass messages (deliberate, client-safe)', () => {
    expect(publicMessageOf(new NotFoundError('This canvassing link is invalid or has been retired.'), FALLBACK)).toBe(
      'This canvassing link is invalid or has been retired.',
    );
    expect(publicMessageOf(new BadRequestError('That household is not part of this turf.'), FALLBACK)).toBe(
      'That household is not part of this turf.',
    );
    expect(publicMessageOf(new UnauthorizedError('Verification required.'), FALLBACK)).toBe('Verification required.');
  });

  it('recognises an AppError structurally, so a duplicate ESM module instance still passes', () => {
    // Same shape as isAppErrorLike expects: an Error carrying numeric status + string code.
    const duckTyped = Object.assign(new Error('Waiting for organizer approval.'), {
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(publicMessageOf(duckTyped, FALLBACK)).toBe('Waiting for organizer approval.');
  });

  it('falls back when an AppError has an empty message', () => {
    const empty = Object.assign(new Error(''), { status: 404, code: 'NOT_FOUND' });
    expect(publicMessageOf(empty, FALLBACK)).toBe(FALLBACK);
  });
});

describe('publicClientMessageOf', () => {
  it('passes through a TRPCError with a client-facing code', () => {
    const soldOut = new TRPCError({ code: 'BAD_REQUEST', message: 'This event is sold out.' });
    expect(publicClientMessageOf(soldOut, FALLBACK)).toBe('This event is sold out.');
  });

  it('returns the fallback for an INTERNAL_SERVER_ERROR TRPCError', () => {
    const internal = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'kysely: connection terminated' });
    expect(publicClientMessageOf(internal, FALLBACK)).toBe(FALLBACK);
  });

  it('returns the fallback for a framework-style error that only carries a statusCode', () => {
    // e.g. a Fastify body-parse error: 4xx statusCode, but its message is not client copy.
    const framework = Object.assign(new Error('Unexpected token < in JSON at position 0'), { statusCode: 400 });
    expect(publicClientMessageOf(framework, FALLBACK)).toBe(FALLBACK);
  });

  it('returns the fallback for a plain Error (e.g. a raw Postgres/Kysely error)', () => {
    const dbError = new Error('duplicate key value violates unique constraint "form_submissions_pkey"');
    expect(publicClientMessageOf(dbError, FALLBACK)).toBe(FALLBACK);
  });

  it('passes through AppError subclass messages, like publicMessageOf does', () => {
    expect(publicClientMessageOf(new BadRequestError('Enter a valid email address.'), FALLBACK)).toBe(
      'Enter a valid email address.',
    );
  });
});
