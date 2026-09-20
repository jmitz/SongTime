function parseMessage(buffer) {
  let message;
  try {
    message = JSON.parse(buffer.toString());
  } catch {
    return null;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  switch (message.type) {
    case "register":
      return ["leader", "user"].includes(message.role) ? message : null;
    case "set-song":
      return typeof message.songId === "string" && /^\d+$/.test(message.songId) ? message : null;
    case "next-section":
    case "previous-section":
      return message;
    case "scroll":
      return Number.isFinite(message.scrollRatio) ? message : null;
    case "set-scroll-speed":
      return Number.isFinite(message.scrollSpeed) ? message : null;
    default:
      return null;
  }
}

module.exports = { parseMessage };
