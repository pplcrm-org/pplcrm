import { TestBed } from '@angular/core/testing';
import { Injectable } from '@angular/core';
import { TRPCService } from './trpc-service';
import { ErrorService } from '../error.service';
import { TokenService } from './token-service';
import { Router } from '@angular/router';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Concrete subclass since TRPCService takes a generic type T.
@Injectable()
class TestTRPCService extends TRPCService<'persons'> {}

describe('TRPCService', () => {
  let service: TestTRPCService;
  let mockErrorSvc: any;
  let mockTokenSvc: any;
  let mockRouter: any;

  beforeEach(() => {
    mockErrorSvc = {
      handle: vi.fn(),
    };

    mockTokenSvc = {
      getAuthToken: vi.fn().mockReturnValue('test-token'),
    };

    mockRouter = {
      navigate: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        TestTRPCService,
        { provide: ErrorService, useValue: mockErrorSvc },
        { provide: TokenService, useValue: mockTokenSvc },
        { provide: Router, useValue: mockRouter },
      ],
    });

    service = TestBed.inject(TestTRPCService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
    expect(service['api']).toBeDefined();
  });

  describe('abort()', () => {
    it('should call abort on the current AbortController and create a new one', () => {
      const initialAc = service['ac'];
      const abortSpy = vi.spyOn(initialAc, 'abort');

      service.abort();

      expect(abortSpy).toHaveBeenCalled();
      expect(service['ac']).not.toBe(initialAc);
    });
  });
});
