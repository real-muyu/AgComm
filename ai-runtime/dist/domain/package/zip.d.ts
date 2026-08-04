export declare const AI_PACKAGE_LIMITS: Readonly<{
    archiveBytes: number;
    entryCount: 512;
    entryCompressedBytes: number;
    entryUncompressedBytes: number;
    totalUncompressedBytes: number;
    pathBytes: 240;
}>;
export type AiPackageZipErrorCode = "ARCHIVE_TOO_LARGE" | "ENTRY_COUNT_EXCEEDED" | "ENTRY_COMPRESSED_TOO_LARGE" | "ENTRY_UNCOMPRESSED_TOO_LARGE" | "TOTAL_UNCOMPRESSED_TOO_LARGE" | "INVALID_PATH" | "DUPLICATE_PATH" | "INVALID_ZIP" | "UNSUPPORTED_ZIP" | "ENCRYPTED_ENTRY" | "UNSUPPORTED_COMPRESSION" | "SIZE_MISMATCH" | "CRC_MISMATCH" | "INVALID_UTF8";
export declare class AiPackageZipError extends Error {
    readonly code: AiPackageZipErrorCode;
    constructor(code: AiPackageZipErrorCode, message: string, options?: ErrorOptions);
}
export declare function createZip(files: Record<string, string>): Blob;
export declare function readZip(buffer: ArrayBuffer): Promise<Record<string, string>>;
