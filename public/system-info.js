const systemIpDisplays = document.querySelectorAll("[data-system-ip]");

function setSystemIpText(value) {
  systemIpDisplays.forEach((element) => {
    element.textContent = value;
  });
}

function isDirectlyUsableHost(hostname) {
  return Boolean(hostname) && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

async function loadSystemInfo() {
  if (systemIpDisplays.length === 0) {
    return;
  }

  // The browser already reached this address. Prefer it over server-side
  // interface guesses, which may point at a container, VPN, or stale LAN IP.
  if (isDirectlyUsableHost(window.location.hostname)) {
    setSystemIpText(window.location.host);
    return;
  }

  try {
    const response = await fetch("/api/system-info");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load system information.");
    }

    const hostname = data.ipAddress && data.ipAddress.includes(":") && !data.ipAddress.startsWith("[")
      ? `[${data.ipAddress}]`
      : data.ipAddress;
    const ipAddress = hostname ? `${hostname}:${data.port}` : "Set PUBLIC_HOST to the server's LAN address";
    setSystemIpText(ipAddress);
  } catch (_error) {
    if (isDirectlyUsableHost(window.location.hostname)) {
      const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
      setSystemIpText(`${window.location.hostname}:${port}`);
      return;
    }

    setSystemIpText("Unavailable");
  }
}

loadSystemInfo();
