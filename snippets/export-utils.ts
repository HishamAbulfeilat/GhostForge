import html2canvas from 'html2canvas';
        import jsPDF from 'jspdf';
        import autoTable from 'jspdf-autotable';
        import * as XLSX from 'xlsx';

        type TableColumn = {
          header: string;
          dataKey: string;
        };

        export async function exportToPDF(elementId: string, filename: string) {
          const element = document.getElementById(elementId);

          if (!element) {
            throw new Error(`Element with id "${elementId}" was not found.`);
          }

          const canvas = await html2canvas(element, {
            scale: 2,
            useCORS: true
          });
          const imageData = canvas.toDataURL('image/png');
          const pdf = new jsPDF('p', 'mm', 'a4');
          const pageWidth = pdf.internal.pageSize.getWidth();
          const pageHeight = (canvas.height * pageWidth) / canvas.width;

          pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, pageHeight);
          pdf.save(`${filename}.pdf`);
        }

        export function exportTableToPDF<T extends Record<string, unknown>>(
          columns: TableColumn[],
          rows: T[],
          filename: string
        ) {
          const pdf = new jsPDF('l', 'mm', 'a4');

          autoTable(pdf, {
            head: [columns.map((column) => column.header)],
            body: rows.map((row) => columns.map((column) => String(row[column.dataKey] ?? '')))
          });

          pdf.save(`${filename}.pdf`);
        }

        export function exportToExcel<T extends Record<string, unknown>>(data: T[], filename: string) {
          const worksheet = XLSX.utils.json_to_sheet(data);
          const workbook = XLSX.utils.book_new();

          XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
          XLSX.writeFile(workbook, `${filename}.xlsx`);
        }

        export function exportToCSV<T extends Record<string, unknown>>(data: T[], filename: string) {
          if (data.length === 0) {
            return;
          }

          const headers = Object.keys(data[0]);
          const rows = data.map((row) =>
            headers
              .map((header) => JSON.stringify(row[header] ?? ''))
              .join(',')
          );
          const csv = [headers.join(','), ...rows].join('
');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');

          link.href = url;
          link.download = `${filename}.csv`;
          link.click();
          URL.revokeObjectURL(url);
        }
