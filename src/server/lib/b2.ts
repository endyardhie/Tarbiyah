import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export type B2Config = {
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  appKey: string;
};

export type B2Object = { key: string; size: number; lastModified: Date | null };

/**
 * Backblaze B2 lewat API S3. Sengaja TIDAK ada fungsi hapus: kunci aplikasi tidak punya izin
 * hapus, dan retensi di B2 diurus lifecycle rules bucket (aturan 17).
 */
export type B2 = {
  put(key: string, body: Readable | Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<B2Object[]>;
};

export const B2_PREFIX = "tarbiyah/";

export function createB2(cfg: B2Config): B2 {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.keyId, secretAccessKey: cfg.appKey },
    // B2 belum mendukung checksum CRC bawaan SDK terbaru pada semua operasi.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async put(key, body, contentType = "application/octet-stream") {
      // Multipart bertahap: bagian 8 MB, satu per satu agar memori tetap kecil.
      await new Upload({
        client,
        params: { Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType },
        partSize: 8 * 1024 * 1024,
        queueSize: 1,
      }).done();
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      if (!res.Body) throw new Error(`Objek B2 kosong: ${key}`);
      return res.Body as Readable;
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return true;
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return false;
        throw e;
      }
    },
    async list(prefix) {
      const out: B2Object[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        for (const o of res.Contents ?? []) {
          if (o.Key)
            out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? null });
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
  };
}
