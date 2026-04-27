declare module 'qrcode' {
  export interface QRCodeToStringOptions {
    type?: 'svg' | 'utf8' | 'terminal'
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    margin?: number
    width?: number
    color?: { dark?: string; light?: string }
  }
  export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>
  export function toDataURL(text: string, options?: any): Promise<string>
  export function toCanvas(canvas: any, text: string, options?: any): Promise<any>
  const QRCode: {
    toString: typeof toString
    toDataURL: typeof toDataURL
    toCanvas: typeof toCanvas
  }
  export default QRCode
}
