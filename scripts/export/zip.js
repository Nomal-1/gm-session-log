/**
 * 아주 작은 zip 작성기 (무압축 "stored" 방식).
 * 외부 라이브러리 없이 zip 형식(PKWARE APPNOTE)을 직접 쓴다.
 * - 이미지·동영상은 이미 압축된 형식이라 추가 압축의 이득이 작다.
 * - 한글 파일 이름이 깨지지 않도록 UTF-8 표시(일반 목적 비트 11)를 켠다.
 * - 한 파일과 전체 크기는 4GB 미만이어야 한다(ZIP64 미지원).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const UTF8_FLAG = 0x0800;
const LIMIT = 0xFFFFFFFF;

/**
 * @param {{path: string, data: Uint8Array|string}[]} files
 * @param {(i: number, n: number) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function makeZip(files, onProgress) {
  const enc = new TextEncoder();
  const { time, day } = dosDateTime(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.path);
    if (data.length >= LIMIT || offset >= LIMIT) throw new Error(`zip 크기 한도(4GB)를 넘었습니다: ${f.path}`);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, UTF8_FLAG, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, day, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + data.length;
    onProgress?.(i + 1, files.length);
    // 큰 파일의 CRC 계산 사이에 화면이 멈추지 않게 잠깐 양보
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
  }

  const cdSize = central.reduce((n, p) => n + p.length, 0);
  if (offset + cdSize >= LIMIT) throw new Error("zip 크기 한도(4GB)를 넘었습니다.");
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/** GM 브라우저에서 바로 내려받는다. 서버에는 아무것도 쓰지 않는다. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // 링크를 화면(문서)에 붙이지 않고 클릭 신호만 보낸다. Foundry의 saveDataToFile과 같은 방식.
  // v0.1.2까지는 문서에 붙였다가 눌렀는데, 받은 파일 이름이 무작위(UUID)로 바뀌었다.
  // 문서에 붙은 링크 클릭을 화면 쪽 처리기가 가로채 이름 없이 연 것으로 보고 고친다.
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
