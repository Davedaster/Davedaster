import { useEffect, useState } from "react";

type ToastTone = "success" | "critical" | "info";

export type AdminToastMessage = {
  id?: string;
  title: string;
  detail?: string;
  tone?: ToastTone;
};

type VisibleToast = Required<Pick<AdminToastMessage, "id" | "title" | "tone">> & {
  detail?: string;
  leaving?: boolean;
};

function toneStyles(tone: ToastTone) {
  if (tone === "critical") {
    return {
      border: "1px solid #fecdca",
      background: "#fff7f5",
      color: "#b42318",
    };
  }

  if (tone === "info") {
    return {
      border: "1px solid #b9d8ff",
      background: "#eff6ff",
      color: "#1d4ed8",
    };
  }

  return {
    border: "1px solid #bbf7d0",
    background: "#ecfdf3",
    color: "#166534",
  };
}

export function AdminToastStack({ messages }: { messages?: AdminToastMessage[] | null }) {
  const [visibleMessages, setVisibleMessages] = useState<VisibleToast[]>([]);

  useEffect(() => {
    if (!messages?.length) {
      return;
    }

    const now = Date.now();
    const nextMessages = messages.map((message, index) => ({
      id: message.id || `${now}-${index}-${message.title}`,
      title: message.title,
      detail: message.detail,
      tone: message.tone || "success" as ToastTone,
      leaving: false,
    }));

    setVisibleMessages((current) => [...current, ...nextMessages]);

    const fadeTimer = window.setTimeout(() => {
      setVisibleMessages((current) => current.map((message) => (
        nextMessages.some((nextMessage) => nextMessage.id === message.id)
          ? { ...message, leaving: true }
          : message
      )));
    }, 5200);

    const removeTimer = window.setTimeout(() => {
      setVisibleMessages((current) => current.filter((message) => !nextMessages.some((nextMessage) => nextMessage.id === message.id)));
    }, 6000);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [JSON.stringify(messages || [])]);

  if (!visibleMessages.length) {
    return null;
  }

  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 99999, display: "grid", gap: 10, width: "min(420px, calc(100vw - 36px))", pointerEvents: "none" }}>
      {visibleMessages.map((message) => {
        const styles = toneStyles(message.tone);

        return (
          <div
            key={message.id}
            style={{
              ...styles,
              borderRadius: 16,
              boxShadow: "0 14px 34px rgba(15,23,42,0.18)",
              padding: "13px 14px",
              opacity: message.leaving ? 0 : 1,
              transform: message.leaving ? "translateY(8px)" : "translateY(0)",
              transition: "opacity 700ms ease, transform 700ms ease",
              pointerEvents: "auto",
              fontFamily: "inherit",
            }}
          >
            <p style={{ margin: 0, fontWeight: 900, fontSize: 14 }}>{message.title}</p>
            {message.detail ? <p style={{ margin: "5px 0 0", fontWeight: 700, fontSize: 13, lineHeight: 1.35, color: "#323841" }}>{message.detail}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
