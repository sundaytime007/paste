import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"],
  },
});

app.use(cors());

// In-memory room storage
// Map<roomCode, { createdAt: number, users: Set<socketId>, messages: Array<{ciphertext, iv, timestamp}> }>
const rooms = new Map();

const MAX_USERS_PER_ROOM = 10;
const ROOM_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 60 * 1000; // check every 60s

// Cleanup expired rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      // Notify remaining users
      io.to(code).emit("room-expired");
      rooms.delete(code);
      console.log(`Room ${code} expired and cleaned up`);
    }
  }
}, CLEANUP_INTERVAL_MS);

function broadcastRoomInfo(roomCode) {
  const room = rooms.get(roomCode);
  if (room) {
    io.to(roomCode).emit("room-info", {
      roomCode,
      userCount: room.users.size,
      maxUsers: MAX_USERS_PER_ROOM,
    });
  }
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  let currentRoom = null;

  socket.on("create-room", (roomCode, callback) => {
    // Validate 3-digit code
    if (!/^\d{3}$/.test(roomCode)) {
      return callback({ success: false, error: "Room code must be exactly 3 digits" });
    }

    if (rooms.has(roomCode)) {
      return callback({ success: false, error: "Room code already in use, please try another" });
    }

    rooms.set(roomCode, {
      createdAt: Date.now(),
      users: new Set([socket.id]),
      messages: [],
    });

    socket.join(roomCode);
    currentRoom = roomCode;
    console.log(`Room ${roomCode} created by ${socket.id}`);

    callback({ success: true });
    broadcastRoomInfo(roomCode);
  });

  socket.on("join-room", (roomCode, callback) => {
    if (!/^\d{3}$/.test(roomCode)) {
      return callback({ success: false, error: "Room code must be exactly 3 digits" });
    }

    const room = rooms.get(roomCode);
    if (!room) {
      return callback({ success: false, error: "Room not found" });
    }

    if (room.users.size >= MAX_USERS_PER_ROOM) {
      return callback({ success: false, error: "Room is full (max 10 users)" });
    }

    room.users.add(socket.id);
    socket.join(roomCode);
    currentRoom = roomCode;
    console.log(`User ${socket.id} joined room ${roomCode}`);

    // Send existing messages (encrypted) to the new user
    callback({ success: true, messages: room.messages });
    broadcastRoomInfo(roomCode);
  });

  socket.on("send-message", ({ ciphertext, iv }) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    const message = {
      ciphertext,
      iv,
      senderId: socket.id,
      timestamp: Date.now(),
    };

    // Store encrypted message
    room.messages.push(message);

    // Broadcast to everyone in the room (including sender for confirmation)
    io.to(currentRoom).emit("receive-message", message);
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users.delete(socket.id);
        broadcastRoomInfo(currentRoom);

        // Optionally clean up empty rooms
        if (room.users.size === 0) {
          rooms.delete(currentRoom);
          console.log(`Room ${currentRoom} deleted (empty)`);
        }
      }
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", rooms: rooms.size });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`QuickPaste server running on port ${PORT}`);
});
