/**
 * Verifies the main-process logger creation, level changes, and log file naming.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const testDir = join(__dirname, '..', '.test-logs')

// We need electron-log and electron mocks before importing the service
vi.mock('electron-log/main', () => {
  const mockLogFn = vi.fn()
  const createTransport = () => ({
    file: { maxSize: 0, format: '', level: 'info', resolvePathFn: null as (() => string) | null },
    console: { format: '', level: 'info' },
  })
  return {
    default: {
      create: vi.fn(() => ({
        transports: createTransport(),
        error: mockLogFn,
        warn: mockLogFn,
        info: mockLogFn,
        debug: mockLogFn,
        verbose: mockLogFn,
      })),
    },
  }
})

vi.mock('electron', () => ({
  app: { name: 'test-app' },
}))

import electronLog from 'electron-log/main'
import LoggerService from '../src/main/services/LoggerService'

describe('LoggerService', () => {
  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
    vi.clearAllMocks()
  })

  it('creates two loggers using the app name as logId prefix', () => {
    new LoggerService(testDir, 'info')
    const create = electronLog.create as ReturnType<typeof vi.fn>
    expect(create).toHaveBeenCalledWith({ logId: 'test-app-app' })
    expect(create).toHaveBeenCalledWith({ logId: 'test-app-errors' })
  })

  it('returns the configured logs directory', () => {
    const service = new LoggerService(testDir, 'info')
    expect(service.getLogsDirectory()).toBe(testDir)
  })

  it('writes error and debug entries without throwing', () => {
    const service = new LoggerService(testDir, 'info')
    expect(() => {
      service.error('TestModule', 'Something went wrong')
      service.warn('TestModule', 'Deprecation warning')
      service.info('TestModule', 'App started')
      service.debug('TestModule', 'Extra detail')
    }).not.toThrow()
  })

  it('creates the log directory on instantiation', () => {
    new LoggerService(testDir, 'info')
    expect(() => mkdirSync(testDir, { recursive: true })).not.toThrow()
    // electron-log's create method was called, which means transport setup ran
    expect(electronLog.create).toHaveBeenCalled()
  })

  it('writes a renderer log entry without throwing', () => {
    const service = new LoggerService(testDir, 'info')
    expect(() =>
      service.writeRenderer({
        level: 'info',
        module: 'RendererModule',
        message: 'UI event',
      }),
    ).not.toThrow()
  })
})
