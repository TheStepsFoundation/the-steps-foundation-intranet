// Ambient module shim for html5-qrcode (the package ships JS only, no .d.ts).
// Pre-existing tsc warning on /students/events/[id]/check-in resolved here so
// the next-build's strict mode doesn't flag it. We type the small surface area
// the scanner page actually uses; everything else is left as `any` to keep
// this declaration stable across html5-qrcode minor releases.

declare module 'html5-qrcode' {
  export interface Html5QrcodeCameraScanConfig {
    fps?: number
    qrbox?: number | { width: number; height: number }
    aspectRatio?: number
    disableFlip?: boolean
  }

  export type Html5QrcodeSuccessCallback = (
    decodedText: string,
    decodedResult: unknown
  ) => void

  export type Html5QrcodeErrorCallback = (
    errorMessage: string,
    error: unknown
  ) => void

  export type CameraDevice = { id: string; label: string }

  export class Html5Qrcode {
    constructor(elementId: string, verbose?: boolean)
    start(
      cameraIdOrConfig: string | { facingMode: string } | { deviceId: string },
      configuration: Html5QrcodeCameraScanConfig,
      qrCodeSuccessCallback: Html5QrcodeSuccessCallback,
      qrCodeErrorCallback?: Html5QrcodeErrorCallback,
    ): Promise<void>
    stop(): Promise<void>
    pause(shouldPauseVideo?: boolean): void
    resume(): void
    clear(): void
    static getCameras(): Promise<CameraDevice[]>
  }
}
