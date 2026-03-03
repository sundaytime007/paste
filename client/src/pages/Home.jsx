import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import socket from "../lib/socket";
import { generateSalt } from "../lib/crypto";

export default function Home() {
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }
  }, []);

  function handleCodeChange(e) {
    const val = e.target.value.replace(/\D/g, "").slice(0, 3);
    setRoomCode(val);
    setError("");
  }

  function handleCreate() {
    if (roomCode.length !== 3) {
      setError("Please enter exactly 3 digits");
      return;
    }

    setLoading(true);
    setError("");

    socket.emit("create-room", roomCode, (res) => {
      setLoading(false);
      if (res.success) {
        const salt = generateSalt();
        navigate(`/room/${roomCode}#salt=${salt}`);
      } else {
        setError(res.error);
      }
    });
  }

  function handleJoin() {
    if (roomCode.length !== 3) {
      setError("Please enter exactly 3 digits");
      return;
    }

    setLoading(true);
    setError("");

    socket.emit("join-room", roomCode, (res) => {
      setLoading(false);
      if (res.success) {
        // When joining, user needs the salt from the shared URL.
        // If they're on this page manually, they need to get the salt from the room creator.
        // For now, navigate — the Room page will check for salt.
        navigate(`/room/${roomCode}${window.location.hash}`);
      } else {
        setError(res.error);
      }
    });
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && roomCode.length === 3) {
      handleJoin();
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-center mb-2">QuickPaste</h1>
        <p className="text-gray-400 text-center text-sm mb-8">
          Sync text & code between devices, end-to-end encrypted
        </p>

        <div className="bg-gray-900 rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Room Code (3 digits)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={roomCode}
              onChange={handleCodeChange}
              onKeyDown={handleKeyDown}
              placeholder="000"
              maxLength={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] placeholder:tracking-[0.5em] placeholder:text-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={loading || roomCode.length !== 3}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
            >
              Create
            </button>
            <button
              onClick={handleJoin}
              disabled={loading || roomCode.length !== 3}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
            >
              Join
            </button>
          </div>
        </div>

        <p className="text-gray-600 text-xs text-center mt-6">
          Rooms expire after 1 hour &middot; Max 10 users per room
        </p>
      </div>
    </div>
  );
}
