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

  try {
    const response = await fetch("/api/system-info");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load system information.");
    }

    const ipAddress = data.ipAddress ? `${data.ipAddress}:${data.port}` : "Unavailable";
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
