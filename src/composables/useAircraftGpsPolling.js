import { ref, onUnmounted, computed } from "vue";
import MSP from "@/js/msp";
import MSPCodes from "@/js/msp/MSPCodes";
import { useFlightControllerStore } from "@/stores/fc";
import { useInterval } from "@/composables/useInterval";
import { have_sensor } from "@/js/sensor_helpers";
import semver from "semver";
import { API_VERSION_1_46 } from "@/js/data_storage";
import { serial } from "@/js/serial";
import { fromLonLat } from "ol/proj";

export function useAircraftGpsPolling(mapInstanceRef, intervalMs = 250) {
    const fcStore = useFlightControllerStore();
    const { addInterval, removeAllIntervals } = useInterval();

    const isPolling = ref(false);
    const aircraftInterval = ref(null);
    const hasHomeFix = ref(false);

    const apiVersion = computed(() => fcStore.config?.apiVersion);
    const hasMag = computed(
        () => have_sensor(fcStore.config?.activeSensors, "mag") && semver.gte(apiVersion.value, API_VERSION_1_46),
    );

    const updateAircraftPosition = () => {
        const instance = mapInstanceRef?.value;
        if (!instance) return;

        const gpsData = fcStore.gpsData || {};
        const sensorData = fcStore.sensorData || {};
        const hasFix = !!gpsData?.fix;

        const {
            map: mapObj,
            iconGeometry: geometry,
            iconFeature: feature,
            iconStyleNoFix,
            iconStyleMag,
            iconStyleGPS,
            mapView,
        } = instance;

        if (!mapObj || !geometry || !feature) return;

        if (!hasFix) {
            feature.setStyle(iconStyleNoFix);
            requestAnimationFrame(() => {
                if (mapObj.getTargetElement()) mapObj.updateSize();
            });
            return;
        }

        const longitude = Number(gpsData?.longitude) / 10000000;
        const latitude = Number(gpsData?.latitude) / 10000000;
        const center = fromLonLat([longitude, latitude]);

        if (!hasHomeFix.value) {
            hasHomeFix.value = true;
            if (mapView) {
                mapView.animate({ center, duration: 500 });
            }
        }

        const imuHeadingDegrees = sensorData?.kinematics?.[2] || 0;
        const imuHeadingRadians = ((imuHeadingDegrees + 180) * Math.PI) / 180;
        const iconStyle = hasMag.value ? iconStyleMag : iconStyleGPS;

        if (iconStyle) {
            iconStyle.getImage().setRotation(imuHeadingRadians);
            feature.setStyle(iconStyle);
        }

        geometry.setCoordinates(center);
        requestAnimationFrame(() => {
            if (mapObj.getTargetElement()) mapObj.updateSize();
        });
    };

    const flyToAircraft = () => {
        const instance = mapInstanceRef?.value;
        if (!instance) return;

        const gpsData = fcStore.gpsData || {};
        const hasFix = !!gpsData?.fix;
        if (!hasFix) return;

        const longitude = Number(gpsData?.longitude) / 10000000;
        const latitude = Number(gpsData?.latitude) / 10000000;
        const { mapView } = instance;
        if (mapView) {
            mapView.animate({ center: fromLonLat([longitude, latitude]), duration: 500 });
        }
    };

    const getMagData = () => {
        if (hasMag.value) {
            MSP.send_message(MSPCodes.MSP_COMPASS_CONFIG, false, false, updateAircraftPosition);
        } else {
            updateAircraftPosition();
        }
    };

    const getImuData = () => {
        MSP.send_message(MSPCodes.MSP_RAW_IMU, false, false, getMagData);
    };

    const getAttitudeData = () => {
        MSP.send_message(MSPCodes.MSP_ATTITUDE, false, false, getImuData);
    };

    const getCompGpsData = () => {
        MSP.send_message(MSPCodes.MSP_COMP_GPS, false, false, getAttitudeData);
    };

    const getRawGpsData = () => {
        if (!serial.connected) return;
        MSP.send_message(MSPCodes.MSP_RAW_GPS, false, false, getCompGpsData);
    };

    const start = () => {
        if (isPolling.value || !serial.connected) return;
        aircraftInterval.value = addInterval("flightplan_aircraft_position", getRawGpsData, intervalMs);
        isPolling.value = true;
    };

    const stop = () => {
        if (!isPolling.value) return;
        removeAllIntervals();
        aircraftInterval.value = null;
        isPolling.value = false;
    };

    onUnmounted(() => stop());

    return { start, stop, isPolling, flyToAircraft };
}
