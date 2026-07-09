import { get as getConfig, set as setConfig } from "../ConfigStorage";
import { bluetoothDevices } from "./devices";

const STORAGE_KEY = "bleProfileOverrides";

/**
 * deviceKey: 기기를 유일하게 식별하는 문자열.
 *   - Android(Capacitor): BLE MAC 주소 (예: "AA:BB:CC:DD:EE:FF")
 *   - 브라우저/Tauri(Web Bluetooth): navigator.bluetooth가 부여하는 device.id
 */
export function getProfileOverride(deviceKey) {
    if (!deviceKey) return null;
    const stored = getConfig(STORAGE_KEY)?.[STORAGE_KEY] ?? {};
    const profileName = stored[deviceKey];
    if (!profileName) return null;

    return bluetoothDevices.find((d) => d.name === profileName) ?? null;
}

export function setProfileOverride(deviceKey, profileName) {
    if (!deviceKey) return;
    const stored = getConfig(STORAGE_KEY)?.[STORAGE_KEY] ?? {};

    if (!profileName) {
        // "자동 감지"를 선택한 경우 오버라이드 삭제
        delete stored[deviceKey];
    } else {
        stored[deviceKey] = profileName;
    }

    setConfig({ [STORAGE_KEY]: stored });
}

/**
 * PortsInput.vue 등에서 드롭다운을 구성할 때 사용.
 * "자동 감지" 옵션 + devices.js에 등록된 모든 BLE 프로필 이름.
 */
export function getSelectableProfiles() {
    return [{ name: "", label: "자동 감지" }, ...bluetoothDevices.map((d) => ({ name: d.name, label: d.name }))];
}
