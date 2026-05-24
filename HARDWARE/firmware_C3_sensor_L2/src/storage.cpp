#include "storage.h"
#include "config.h"
#include <Preferences.h>

static Preferences prefs;

void storage_reset_defaults(DeviceConfig &cfg) {
    cfg.zero_distance_mm    = DEFAULT_ZERO_MM;
    cfg.level1_threshold_mm = DEFAULT_LEVEL1_MM;
    cfg.level2_threshold_mm = DEFAULT_LEVEL2_MM;
    cfg.trigger_delay_s     = DEFAULT_TRIGGER_DELAY_S;
    cfg.clear_delay_s       = DEFAULT_CLEAR_DELAY_S;
    cfg.device_name[0]      = '\0';
    cfg.config_version      = CONFIG_VERSION;
}

void storage_init() {
    prefs.begin(NVS_NAMESPACE, false);
}

void storage_load(DeviceConfig &cfg) {
    storage_reset_defaults(cfg);
    if (!prefs.isKey("cfg_ver")) return;  // no saved config yet

    cfg.zero_distance_mm    = prefs.getUInt("zero_mm",  cfg.zero_distance_mm);
    cfg.level1_threshold_mm = prefs.getUInt("l1_mm",    cfg.level1_threshold_mm);
    cfg.level2_threshold_mm = prefs.getUInt("l2_mm",    cfg.level2_threshold_mm);
    cfg.trigger_delay_s     = prefs.getUInt("trig_s",   cfg.trigger_delay_s);
    cfg.clear_delay_s       = prefs.getUInt("clr_s",    cfg.clear_delay_s);
    cfg.config_version      = prefs.getUInt("cfg_ver",  cfg.config_version);
}

void storage_save(const DeviceConfig &cfg) {
    prefs.putUInt("zero_mm", cfg.zero_distance_mm);
    prefs.putUInt("l1_mm",   cfg.level1_threshold_mm);
    prefs.putUInt("l2_mm",   cfg.level2_threshold_mm);
    prefs.putUInt("trig_s",  cfg.trigger_delay_s);
    prefs.putUInt("clr_s",   cfg.clear_delay_s);
    prefs.putUInt("cfg_ver", cfg.config_version);
}
