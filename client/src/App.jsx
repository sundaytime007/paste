import { createBrowserRouter, RouterProvider } from "react-router";
import Home from "./pages/Home.jsx";
import Room from "./pages/Room.jsx";

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/room/:roomCode", element: <Room /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
