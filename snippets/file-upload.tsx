import * as React from 'react';
import { useDropzone, type Accept } from 'react-dropzone';

interface UploadItem {
  file: File;
  preview?: string;
  progress: number;
  error?: string;
}

interface FileUploadProps {
  accept?: Accept;
  maxSize?: number;
  multiple?: boolean;
}

export function FileUpload({
  accept = {
    'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
    'application/pdf': ['.pdf']
  },
  maxSize = 5 * 1024 * 1024,
  multiple = true
}: FileUploadProps) {
  const [items, setItems] = React.useState<UploadItem[]>([]);

  const onDrop = React.useCallback(
    (acceptedFiles: File[], rejectedFiles: { file: File; errors: { message: string }[] }[]) => {
      const accepted = acceptedFiles.map<UploadItem>((file) => ({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        progress: 0
      }));

      const rejected = rejectedFiles.map<UploadItem>(({ file, errors }) => ({
        file,
        progress: 0,
        error: errors[0]?.message ?? 'File rejected'
      }));

      setItems((current) => [...current, ...accepted, ...rejected]);
    },
    []
  );

  const { getInputProps, getRootProps, isDragActive } = useDropzone({
    accept,
    maxSize,
    multiple,
    onDrop
  });

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      setItems((current) =>
        current.map((item) => {
          if (item.error || item.progress >= 100) {
            return item;
          }

          return {
            ...item,
            progress: Math.min(item.progress + 20, 100)
          };
        })
      );
    }, 500);

    return () => window.clearInterval(interval);
  }, []);

  React.useEffect(() => {
    return () => {
      items.forEach((item) => {
        if (item.preview) {
          URL.revokeObjectURL(item.preview);
        }
      });
    };
  }, [items]);

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`rounded-2xl border-2 border-dashed p-8 text-center ${
          isDragActive ? 'border-slate-900 bg-slate-50' : 'border-slate-300'
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-sm text-slate-600">
          Drag and drop files here, or click to browse.
        </p>
        <p className="mt-2 text-xs text-slate-400">Max file size: {Math.round(maxSize / 1024 / 1024)} MB</p>
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={`${item.file.name}-${item.file.lastModified}`} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                {item.preview ? (
                  <img src={item.preview} alt={item.file.name} className="h-14 w-14 rounded-lg object-cover" />
                ) : null}
                <div>
                  <p className="font-medium text-slate-900">{item.file.name}</p>
                  <p className="text-xs text-slate-500">{Math.round(item.file.size / 1024)} KB</p>
                  {item.error ? <p className="text-xs text-red-600">{item.error}</p> : null}
                </div>
              </div>
              <span className="text-sm text-slate-500">{item.progress}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${item.error ? 'bg-red-500' : 'bg-slate-900'}`}
                style={{ width: `${item.progress}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
