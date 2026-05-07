"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Heading3,
  Quote,
  Strikethrough,
  Code,
  Link as LinkIcon,
  ImagePlus,
  Undo2,
  Redo2,
  Loader2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadMessageImage, ImageUploadError } from "@/lib/firebase/storage";
import { cn } from "@/lib/utils";

interface RichEditorProps {
  value: string;
  onChange: (html: string, plain: string) => void;
  uploaderUid: string | null;
  placeholder?: string;
  /** Soft cap on plain-text length (the form shows the counter). */
  maxPlainLength?: number;
  className?: string;
  disabled?: boolean;
}

export function RichEditor({
  value,
  onChange,
  uploaderUid,
  placeholder = "Write your message…",
  maxPlainLength = 2000,
  className,
  disabled,
}: RichEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
          class: "text-brand-300 underline decoration-dotted",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: "rounded-xl border border-white/10 my-3 max-h-[420px] object-contain",
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          "before:content-[attr(data-placeholder)] before:text-muted before:float-left before:h-0 before:pointer-events-none",
      }),
    ],
    immediatelyRender: false,
    editable: !disabled,
    content: value || "",
    editorProps: {
      attributes: {
        class: cn(
          "prose-message tiptap min-h-[140px] max-h-[60vh] overflow-y-auto px-4 py-3 text-sm",
          "focus:outline-none"
        ),
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.isEmpty ? "" : editor.getHTML();
      const plain = editor.getText();
      onChange(html, plain);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value === editor.getHTML()) return;
    if (!value && editor.isEmpty) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!editor) return;
      if (!uploaderUid) {
        toast.error("Sign in to attach images.");
        return;
      }
      setUploading(true);
      try {
        const { url } = await uploadMessageImage({ userId: uploaderUid, file });
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      } catch (e) {
        const msg =
          e instanceof ImageUploadError
            ? e.message
            : e instanceof Error
            ? e.message
            : "Upload failed.";
        toast.error(msg);
      } finally {
        setUploading(false);
      }
    },
    [editor, uploaderUid]
  );

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleUpload(file);
    e.target.value = "";
  };

  const promptLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const next = window.prompt("Link URL", previous || "https://");
    if (next === null) return;
    if (next === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    let url = next.trim();
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
      url = `https://${url}`;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  if (!editor) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 min-h-[180px] animate-pulse" />
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/5 transition-colors",
        "focus-within:border-brand/60 focus-within:bg-white/10",
        disabled && "opacity-60 pointer-events-none",
        className
      )}
      onPaste={async (e) => {
        const file = Array.from(e.clipboardData.files).find((f) =>
          f.type.startsWith("image/")
        );
        if (file) {
          e.preventDefault();
          await handleUpload(file);
        }
      }}
      onDrop={async (e) => {
        const file = Array.from(e.dataTransfer.files).find((f) =>
          f.type.startsWith("image/")
        );
        if (file) {
          e.preventDefault();
          await handleUpload(file);
        }
      }}
    >
      <Toolbar
        editor={editor}
        onPickImage={() => fileInputRef.current?.click()}
        onLink={promptLink}
        uploading={uploading}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={onPickFile}
      />
      <EditorContent editor={editor} />
      <Counter editor={editor} max={maxPlainLength} />
    </div>
  );
}

function Toolbar({
  editor,
  onPickImage,
  onLink,
  uploading,
}: {
  editor: Editor;
  onPickImage: () => void;
  onLink: () => void;
  uploading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-white/10 px-2 py-1.5">
      <ToolBtn
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="Bold"
      >
        <Bold size={15} />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="Italic"
      >
        <Italic size={15} />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="Strikethrough"
      >
        <Strikethrough size={15} />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
        label="Inline code"
      >
        <Code size={15} />
      </ToolBtn>

      <Sep />

      <ToolBtn
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Heading 2"
      >
        <Heading2 size={15} />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="Heading 3"
      >
        <Heading3 size={15} />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="Bullet list"
      >
        <List size={15} />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="Numbered list"
      >
        <ListOrdered size={15} />
      </ToolBtn>
      <ToolBtn
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="Quote"
      >
        <Quote size={15} />
      </ToolBtn>

      <Sep />

      <ToolBtn
        active={editor.isActive("link")}
        onClick={onLink}
        label="Link"
      >
        <LinkIcon size={15} />
      </ToolBtn>
      <ToolBtn onClick={onPickImage} label="Insert image" disabled={uploading}>
        {uploading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <ImagePlus size={15} />
        )}
      </ToolBtn>

      <div className="ml-auto flex items-center gap-0.5">
        <ToolBtn
          onClick={() => editor.chain().focus().undo().run()}
          label="Undo"
          disabled={!editor.can().undo()}
        >
          <Undo2 size={15} />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().redo().run()}
          label="Redo"
          disabled={!editor.can().redo()}
        >
          <Redo2 size={15} />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().clearContent().run()}
          label="Clear"
          disabled={editor.isEmpty}
        >
          <Trash2 size={15} />
        </ToolBtn>
      </div>
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  children,
  label,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded-md text-muted",
        "hover:bg-white/10 hover:text-foreground transition-colors",
        active && "bg-brand-500/20 text-foreground",
        disabled && "opacity-40 hover:bg-transparent cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-white/10" />;
}

function Counter({ editor, max }: { editor: Editor; max: number }) {
  const len = editor.getText().length;
  const over = len > max;
  return (
    <div className="flex items-center justify-end px-3 pb-2 text-[11px] text-muted">
      <span className={cn(over && "text-red-400 font-semibold")}>
        {len.toLocaleString()}/{max.toLocaleString()}
      </span>
    </div>
  );
}
