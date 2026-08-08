export declare function arrayBufferOf(value: Uint8Array): ArrayBuffer;
export declare function readRuntimePackageInput(pathOrBytes: string | Uint8Array | ArrayBuffer): Promise<{
    buffer: ArrayBuffer;
    fallbackName: string;
}>;
