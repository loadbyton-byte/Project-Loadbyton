// Real-time messaging client — one Socket.IO connection shared across the
// app (not one per component), joined/left per job as the user navigates.
// Mirrors api.js's API_BASE_URL handling: relative/same-origin by default
// (rides the Vercel /api/* rewrite to the backend, same as every REST
// call), or VITE_API_URL for direct cross-origin backend calls.
import { io } from 'socket.io-client';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

let socket = null;

export function getSocket() {
  if (socket) return socket;
  socket = io(API_BASE_URL || undefined, {
    path: '/api/socket.io',
    withCredentials: true,
    autoConnect: false,
  });
  return socket;
}
