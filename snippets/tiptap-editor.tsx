import * as React from 'react';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor } from '@tiptap/react';

interface RichTextEditorProps {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
}

export function RichTextEditor({
  value = '<p>Hello world!</p>',
  placeholder = 'Start writing...',
  onChange
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Color,
      Underline,
      Placeholder.configure({ placeholder })
    ],
    content: value,
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(currentEditor.getHTML());
    }
  });

  if (!editor) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap gap-2">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>
          Bold
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}>
          Italic
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')}>
          Underline
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>
          Bullet List
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })}>
          Left
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })}>
          Center
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setColor('#0052cc').run()} active={editor.isActive('textStyle', { color: '#0052cc' })}>
          Brand
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} className="min-h-[12rem] rounded-xl border border-slate-200 p-3" />

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-700">HTML output</h3>
        <pre className="overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
          {editor.getHTML()}
        </pre>
      </div>
    </div>
  );
}

function ToolbarButton({
  active,
  children,
  onClick
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-300 bg-white text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
