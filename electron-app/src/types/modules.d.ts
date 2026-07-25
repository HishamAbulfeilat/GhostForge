declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, any>;
    metadata: any;
    text: string;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer, options?: Record<string, any>): Promise<PDFData>;
  export = pdfParse;
}

declare module 'mammoth' {
  interface ExtractResult {
    value: string;
    messages: any[];
  }
  export function extractRawText(options: { path: string }): Promise<ExtractResult>;
  export function extractRawText(options: { buffer: Buffer }): Promise<ExtractResult>;
}

declare module 'xlsx' {
  interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, any>;
  }
  export function readFile(path: string): WorkBook;
  export function write(data: any[], opts?: any): any;
  export const utils: {
    sheet_to_csv(sheet: any): string;
    sheet_to_json(sheet: any): any[];
    sheet_to_formulae(sheet: any): string[];
    json_to_sheet(data: any[]): any;
    book_new(): WorkBook;
    book_append_sheet(wb: WorkBook, ws: any, name: string): void;
  };
  export type { WorkBook };
}
