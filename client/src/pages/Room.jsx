import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import socket from "../lib/socket";
import { deriveKey, encrypt, decrypt, generateSalt } from "../lib/crypto";

export default function Room() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [userCount, setUserCount] = useState(0);
  const [connected, setConnected] = useState(socket.connected);
  const [copied, setCopied] = useState(null); // messageIndex or "link"
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const keyRef = useRef(null);
  const messagesEndRef = useRef(null);
  const saltRef = useRef("");
  const joinedRef = useRef(false);

  // Extract salt from URL hash
  const getSalt = useCallback(() => {
    const hash = window.location.hash;
    const match = hash.match(/salt=([a-f0-9]+)/i);
    return match ? match[1] : null;
  }, []);

  // Derive encryption key and join room
  useEffect(() => {
    if (joinedRef.current) return;

    const salt = getSalt();
    if (!salt) {
      // No salt — ask user to use the full shared link
      setError("Missing encryption key. Please use the full shared link to join this room.");
      return;
    }

    saltRef.current = salt;

    async function init() {
      try {
        keyRef.current = await deriveKey(roomCode, salt);
      } catch {
        setError("Failed to derive encryption key");
        return;
      }

      if (!socket.connected) {
        socket.connect();
      }

      joinedRef.current = true;

      // Join or create room
      socket.emit("join-room", roomCode, async (res) => {
        if (res.success) {
          // Decrypt existing messages
          if (res.messages && res.messages.length > 0) {
            const decrypted = [];
            for (const msg of res.messages) {
              try {
                const text = await decrypt(msg.ciphertext, msg.iv, keyRef.current);
                decrypted.push({
                  text,
                  timestamp: msg.timestamp,
                  senderId: msg.senderId,
                  isMe: msg.senderId === socket.id,
                });
              } catch {
                decrypted.push({
                  text: "[Decryption failed]",
                  timestamp: msg.timestamp,
                  senderId: msg.senderId,
                  isMe: false,
                });
              }
            }
            setMessages(decrypted);
          }
        } else if (res.error === "Room not found") {
          // Room doesn't exist yet — create it
          socket.emit("create-room", roomCode, (createRes) => {
            if (!createRes.success) {
              setError(createRes.error);
            }
          });
        } else {
          setError(res.error);
        }
      });
    }

    init();
  }, [roomCode, getSalt]);

  // Socket event listeners
  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onRoomInfo({ userCount: count }) {
      setUserCount(count);
    }
    async function onReceiveMessage(msg) {
      if (!keyRef.current) return;
      try {
        const text = await decrypt(msg.ciphertext, msg.iv, keyRef.current);
        setMessages((prev) => [
          ...prev,
          {
            text,
            timestamp: msg.timestamp,
            senderId: msg.senderId,
            isMe: msg.senderId === socket.id,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            text: "[Decryption failed]",
            timestamp: msg.timestamp,
            senderId: msg.senderId,
            isMe: false,
          },
        ]);
      }
    }
    function onRoomExpired() {
      setError("This room has expired.");
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room-info", onRoomInfo);
    socket.on("receive-message", onReceiveMessage);
    socket.on("room-expired", onRoomExpired);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room-info", onRoomInfo);
      socket.off("receive-message", onReceiveMessage);
      socket.off("room-expired", onRoomExpired);
    };
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || !keyRef.current) return;

    setSending(true);
    try {
      const { ciphertext, iv } = await encrypt(input, keyRef.current);
      socket.emit("send-message", { ciphertext, iv });
      setInput("");
    } catch {
      setError("Encryption failed");
    }
    setSending(false);
  }

  function handleKeyDown(e) {
    // Ctrl/Cmd + Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  async function copyText(text, id) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback
    }
  }

  function copyLink() {
    const url = window.location.href;
    copyText(url, "link");
  }

  function copyAll() {
    if (messages.length === 0) return;
    const allText = messages.map((msg) => msg.text).join("\n\n");
    copyText(allText, "all");
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (error && !messages.length) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={() => navigate("/")}
            className="text-blue-600 hover:text-blue-700 underline"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 text-gray-900 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shrink-0">
        <button
          onClick={() => navigate("/")}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          &larr; Home
        </button>

        <div className="text-center">
          <span className="font-mono text-lg font-bold">{roomCode}</span>
          <span className="ml-3 text-xs text-gray-500">
            {connected ? (
              <span className="text-green-500">&#9679;</span>
            ) : (
              <span className="text-red-500">&#9679;</span>
            )}{" "}
            {userCount}/10
          </span>
        </div>

        <button
          onClick={copyLink}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          {copied === "link" ? "Copied!" : "Share Link"}
        </button>
      </header>

      {/* Messages toolbar */}
      {messages.length > 0 && (
        <div className="flex items-center justify-end px-4 py-1.5 bg-white/60 border-b border-gray-200 shrink-0">
          <button
            onClick={copyAll}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            {copied === "all" ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-500"><path d="M20 6 9 17l-5-5"/></svg>
                <span className="text-green-500">Copied all!</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                Copy All
              </>
            )}
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-gray-400 text-center text-sm mt-8">
            No messages yet. Paste something below to share.
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`rounded-lg ${
              msg.isMe
                ? "bg-blue-50 border border-blue-200"
                : "bg-white border border-gray-200"
            }`}
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
              <span className="text-xs text-gray-400">
                {msg.isMe ? "You" : "Peer"} &middot; {formatTime(msg.timestamp)}
              </span>
              <button
                onClick={() => copyText(msg.text, i)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {copied === i ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="px-3 py-2 text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto text-gray-800">
              {msg.text}
            </pre>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="shrink-0 p-3 bg-white border-t border-gray-200">
        {error && messages.length > 0 && (
          <p className="text-red-500 text-xs mb-2">{error}</p>
        )}
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste text or code here..."
            rows={3}
            className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            style={{ whiteSpace: "pre-wrap", tabSize: 4 }}
          />
          <div className="flex flex-col gap-2">
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 rounded-lg transition-colors"
            >
              Send
            </button>
            <button
              onClick={() => setInput("")}
              className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm px-4 rounded-lg border border-gray-300 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
        <p className="text-gray-400 text-xs mt-1.5">
          Ctrl+Enter to send &middot; End-to-end encrypted
        </p>
      </div>
    </div>
  );
}
