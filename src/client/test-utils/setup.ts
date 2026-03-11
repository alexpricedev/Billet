import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Save Bun's native implementations before registering happy-dom
// These need to be restored after registration to avoid breaking server tests
const BunResponse = globalThis.Response;
const BunHeaders = globalThis.Headers;
const BunRequest = globalThis.Request;
const BunFormData = globalThis.FormData;
const BunBlob = globalThis.Blob;
const BunFile = globalThis.File;
const BunReadableStream = globalThis.ReadableStream;
const BunWritableStream = globalThis.WritableStream;
const BunTransformStream = globalThis.TransformStream;

GlobalRegistrator.register({
  url: "http://localhost:3000",
  width: 1920,
  height: 1080,
});

// Restore Bun's native implementations for server-side use
if (BunResponse) globalThis.Response = BunResponse;
if (BunHeaders) globalThis.Headers = BunHeaders;
if (BunRequest) globalThis.Request = BunRequest;
if (BunFormData) globalThis.FormData = BunFormData;
if (BunBlob) globalThis.Blob = BunBlob;
if (BunFile) globalThis.File = BunFile;
if (BunReadableStream) globalThis.ReadableStream = BunReadableStream;
if (BunWritableStream) globalThis.WritableStream = BunWritableStream;
if (BunTransformStream) globalThis.TransformStream = BunTransformStream;
