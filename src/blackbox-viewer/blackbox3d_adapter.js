import { useLogStore } from "./stores/log.js";

// Adapts the currently loaded FlightLog (from the blackbox viewer) into the
// shape that the 3D replay expects from a parsed CSV. This replaces the HTML
// prototype's parseCSV() which read raw CSV text — here we pull the same named
// fields directly out of the FlightLog object so no CSV round-trip is needed.
//
// Returns the same contract as the prototype's parseCSV():
//   { out, headers, wpLat, wpLon, wpAlt, iALat, iALon, iAAlt, iBLat, iBLon, iBAlt, iAlt, iMode }
// where each `out` row is { _raw, t, lat, lon, roll, pitch, yaw, throttle, alt,
// baroAlt, gpsAlt, velN, velE } and `_raw` is the raw numeric frame array
// (used by buildMarkers/buildFrames for WP and A/B rescue altitudes).

const WP_COUNT = 15;

function fieldIndexOrNeg(log, name) {
    const i = log.getMainFieldIndexByName(name);
    return i === undefined || i === null ? -1 : i;
}

export function buildReplayDataFromFlightLog() {
    const logStore = useLogStore();
    const log = logStore.flightLog;
    if (!log) {
        throw new Error("No blackbox log is loaded");
    }

    // Ensure the correct sub-log (multiple logs can live in one .bbl) is selected.
    const index = logStore.activeLogIndex ?? 0;
    if (typeof log.openLog === "function") {
        log.openLog(index);
    }

    const names = log.getMainFieldNames();

    const idx = (name) => fieldIndexOrNeg(log, name);
    const iLat = idx("GPS_coord[0]");
    const iLon = idx("GPS_coord[1]");
    const iRoll = idx("heading[0]");
    const iPitch = idx("heading[1]");
    const iYaw = idx("heading[2]");
    const iThr = idx("throttle");
    const iRcThr = idx("rcCommands[3]"); // betaflight field name (HTML used rcCommand[3])
    const iVelN = idx("GPS_velned[0]");
    const iVelE = idx("GPS_velned[1]");
    const iAlt = idx("GPS_altitude");
    const iBaroAlt = idx("baroAlt");
    const iTime = idx("time");
    const iLoop = idx("loopIteration");
    const iMode = idx("flightModeFlags");

    const wpLat = [],
        wpLon = [],
        wpAlt = [];
    for (let i = 0; i < WP_COUNT; i++) {
        wpLat.push(idx(`GPS_wp_${i}_lat`));
        wpLon.push(idx(`GPS_wp_${i}_lon`));
        wpAlt.push(idx(`GPS_wp_${i}_alt`));
    }
    const iALat = idx("GPS_A_lat"),
        iALon = idx("GPS_A_lon"),
        iAAlt = idx("GPS_A_alt");
    const iBLat = idx("GPS_B_lat"),
        iBLon = idx("GPS_B_lon"),
        iBAlt = idx("GPS_B_alt");

    const num = (vals, k) => {
        if (k < 0 || vals == null || k >= vals.length) return null;
        const v = parseFloat(vals[k]);
        return Number.isNaN(v) ? null : v;
    };

    const minTime = log.getMinTime(index);
    const maxTime = log.getMaxTime(index);
    const out = [];
    // Walk the parsed frames directly via chunk enumeration (loop-iteration
    // granularity, matching the prototype's per-CSV-row sampling) instead of
    // doing a getFrameAtTime() lookup per millisecond.
    const chunks = log.getChunksInTimeRange(minTime, maxTime);
    for (const chunk of chunks) {
        for (const row of chunk.frames) {
            const loopIter = iLoop >= 0 ? num(row, iLoop) : -1;
            if (loopIter === 0) continue; // skip first frame (often NaN)
            const tt = iTime >= 0 ? num(row, iTime) : iLoop >= 0 ? num(row, iLoop) : out.length;
            if (tt == null) continue;
            out.push({
                _raw: row,
                t: tt,
                lat: iLat >= 0 ? num(row, iLat) : null,
                lon: iLon >= 0 ? num(row, iLon) : null,
                roll: iRoll >= 0 ? num(row, iRoll) : 0,
                pitch: iPitch >= 0 ? num(row, iPitch) : 0,
                yaw: iYaw >= 0 ? num(row, iYaw) : 0,
                throttle: (iThr >= 0 ? num(row, iThr) : iRcThr >= 0 ? num(row, iRcThr) : 0) || 0,
                alt: iAlt >= 0 ? num(row, iAlt) : 0,
                baroAlt: iBaroAlt >= 0 ? num(row, iBaroAlt) : 0,
                gpsAlt: iAlt >= 0 ? num(row, iAlt) : 0,
                velN: iVelN >= 0 ? num(row, iVelN) : 0,
                velE: iVelE >= 0 ? num(row, iVelE) : 0,
            });
        }
    }

    return {
        out,
        headers: names,
        wpLat,
        wpLon,
        wpAlt,
        iALat,
        iALon,
        iAAlt,
        iBLat,
        iBLon,
        iBAlt,
        iAlt,
        iMode,
    };
}
