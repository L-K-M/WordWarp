import type { WordWarpDocument } from '../model/types';

export interface ExportPngRequest {
  type: 'export-png';
  id: string;
  document: WordWarpDocument;
  scale: number;
}

export type ExportWorkerRequest = ExportPngRequest;

export type ExportWorkerResponse =
  | { type: 'export-complete'; id: string; bytes: ArrayBuffer; width: number; height: number }
  | { type: 'export-error'; id: string; message: string };
