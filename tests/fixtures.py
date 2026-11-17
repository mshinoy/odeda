"""Handcrafted Garmin payloads.

These are the shapes the private Connect API returns, written out by hand. They are
*not* captured from a live account — there is no Garmin login on this machine — so they
verify the normalisers against the documented/observed field names and units, and they
deliberately include the awkward cases: missing keys, nested DTOs, alternative spellings
and unit quirks (grams for weight, centimetres and milliseconds in the export).

If the real API turns out to differ, that is a fixture bug, and fixing it is a one-file
change plus a `odeda renormalize` — no re-fetching.
"""

from __future__ import annotations

ACTIVITY = {
    "activityId": 987654321,
    "activityName": "Doha Corniche morning run",
    "startTimeLocal": "2026-09-20 05:42:11",
    "startTimeGMT": "2026-09-20 02:42:11",
    "activityType": {"typeId": 1, "typeKey": "running", "parentTypeId": 17},
    "eventType": {"typeId": 9, "typeKey": "uncategorized"},
    "distance": 12043.28,
    "duration": 3721.5,
    "elapsedDuration": 3790.0,
    "movingDuration": 3688.0,
    "elevationGain": 41.0,
    "elevationLoss": 39.0,
    "averageSpeed": 3.266,
    "maxSpeed": 4.512,
    "averageHR": 152.0,
    "maxHR": 174.0,
    "calories": 812.0,
    "averageRunningCadenceInStepsPerMinute": 173.4,
    "aerobicTrainingEffect": 3.6,
    "anaerobicTrainingEffect": 0.9,
    "vO2MaxValue": 52.0,
    # A field the app does not model. It must survive in raw_documents.
    "summarizedDiveInfo": {"weightList": []},
}

# Same activity, but with everything nested under summaryDTO — the shape the
# per-activity detail endpoint uses.
ACTIVITY_NESTED = {
    "activityId": 111,
    "activityName": "Nested shape",
    "startTimeLocal": "2026-09-19 06:00:00",
    "activityTypeDTO": {"typeKey": "trail_running"},
    "summaryDTO": {
        "distance": 8000.0,
        "duration": 2800.0,
        "movingDuration": 2750.0,
        "averageHR": 148.0,
        "maxHR": 166.0,
        "averageSpeed": 2.909,
        "elevationGain": 210.0,
        "calories": 540.0,
    },
}

# An activity with almost nothing filled in — a manually entered session.
ACTIVITY_SPARSE = {
    "activityId": 222,
    "startTimeLocal": "2026-09-18 19:00:00",
    "activityType": {"typeKey": "strength_training"},
    "duration": 2400.0,
}

# A gym session as the activity list returns it: exercises summed over their sets.
# Weights are grams, volume is grams x reps, durations are ms. Garmin leaves
# `maxWeight` out for bodyweight work and `subCategory` out when it has no variant.
STRENGTH_ACTIVITY = {
    "activityId": 333,
    "activityName": "Evening strength",
    "startTimeLocal": "2026-09-17 18:30:00",
    "startTimeGMT": "2026-09-17 15:30:00",
    "activityType": {"typeKey": "strength_training"},
    "duration": 2700.0,
    "averageHR": 112.0,
    "totalSets": 6,          # 3 + 2 + 1
    "activeSets": 6,
    "totalReps": 50,         # 24 + 16 + 10
    "summarizedExerciseSets": [
        {"category": "BENCH_PRESS", "sets": 3, "reps": 24, "maxWeight": 50000,
         "volume": 1200000, "duration": 150000.5},             # 50 kg x 24 reps
        {"category": "DEADLIFT", "subCategory": "ROMANIAN_DEADLIFT", "sets": 2,
         "reps": 16, "maxWeight": 60000, "volume": 960000,     # 60 kg x 16 reps
         "duration": 95000.0},
        {"category": "UNKNOWN", "sets": 1, "reps": 10, "volume": 0,
         "duration": 30000.0},
    ],
}

HR_ZONES = [
    {"zoneNumber": 1, "secsInZone": 245.0, "zoneLowBoundary": 97},
    {"zoneNumber": 2, "secsInZone": 1180.0, "zoneLowBoundary": 120},
    {"zoneNumber": 3, "secsInZone": 1660.0, "zoneLowBoundary": 141},
    {"zoneNumber": 4, "secsInZone": 520.0, "zoneLowBoundary": 162},
    {"zoneNumber": 5, "secsInZone": 83.0, "zoneLowBoundary": 176},
]

SLEEP = {
    "dailySleepDTO": {
        "id": 1758300000000,
        "calendarDate": "2026-09-20",
        "sleepTimeSeconds": 26580,
        "napTimeSeconds": 0,
        # Garmin's sleepTimeSeconds excludes awake time, so the three stages sum to it.
        "deepSleepSeconds": 4980,
        "lightSleepSeconds": 16260,
        "remSleepSeconds": 5340,
        "awakeSleepSeconds": 1200,
        "sleepStartTimestampLocal": "2026-09-19 22:41:00",
        "sleepEndTimestampLocal": "2026-09-20 06:14:00",
        "averageRespirationValue": 13.8,
        "averageSpO2Value": 95.0,
        "avgOvernightHrv": 61.0,
        "sleepScores": {
            "overall": {"value": 78, "qualifierKey": "GOOD"},
            "deepPercentage": {"value": 19, "qualifierKey": "GOOD"},
        },
    },
    "restingHeartRate": 51,
    "remSleepData": True,
}

# Older devices report no sleep score and no HRV.
SLEEP_MINIMAL = {
    "dailySleepDTO": {
        "calendarDate": "2026-09-19",
        "sleepTimeSeconds": 24000,
        "deepSleepSeconds": 4000,
        "lightSleepSeconds": 16000,
        "remSleepSeconds": 4000,
        "awakeSleepSeconds": 900,
    }
}

DAILY_SUMMARY = {
    "userProfileId": 12345,
    "calendarDate": "2026-09-20",
    "totalKilocalories": 3120.0,
    "activeKilocalories": 940.0,
    "totalSteps": 14208,
    "totalDistanceMeters": 11840,
    "floorsAscended": 12.0,
    "minHeartRate": 48,
    "maxHeartRate": 174,
    "restingHeartRate": 51,
    "averageStressLevel": 28,
    "maxStressLevel": 82,
    "moderateIntensityMinutes": 22,
    "vigorousIntensityMinutes": 41,
    "bodyBatteryChargedValue": 62,
    "bodyBatteryDrainedValue": 58,
    "bodyBatteryHighestValue": 88,
    "bodyBatteryLowestValue": 24,
}

HRV = {
    "userProfilePk": 12345,
    "hrvSummary": {
        "calendarDate": "2026-09-20",
        "weeklyAvg": 59,
        "lastNightAvg": 61,
        "lastNight5MinHigh": 78,
        "baseline": {
            "lowUpper": 48,
            "balancedLow": 52,
            "balancedUpper": 68,
            "markerValue": 0.51,
        },
        "status": "BALANCED",
        "feedbackPhrase": "HRV_BALANCED_1",
    },
}

TRAINING_READINESS = [
    {
        "userProfilePK": 12345,
        "calendarDate": "2026-09-20",
        "timestamp": "2026-09-20T03:15:00.0",
        "level": "HIGH",
        "score": 74,
        "sleepScore": 78,
        "recoveryTime": 12,
        "hrvFactorPercent": 88,
    }
]

TRAINING_STATUS = {
    "userId": 12345,
    "calendarDate": "2026-09-20",
    "mostRecentVO2Max": {
        "generic": {"calendarDate": "2026-09-20", "vo2MaxValue": 52.0,
                    "vo2MaxPreciseValue": 52.3, "fitnessAge": 31},
        "cycling": {"calendarDate": "2026-09-14", "vo2MaxValue": 48.0,
                    "vo2MaxPreciseValue": 48.2},
    },
    "mostRecentTrainingStatus": {
        "latestTrainingStatusData": {
            "3405512345": {
                "calendarDate": "2026-09-20",
                "trainingStatus": 3,
                "trainingStatusFeedbackPhrase": "PRODUCTIVE_1",
                "acuteTrainingLoadDTO": {
                    "acwrStatus": 1.12,
                    "dailyAcuteChronicWorkloadRatio": 1.12,
                    "dailyTrainingLoadAcute": 612,
                    "dailyTrainingLoadChronic": 547,
                },
            }
        }
    },
}

WEIGHT = {
    "dailyWeightSummaries": [
        {
            "summaryDate": "2026-09-20",
            "numOfWeightEntries": 1,
            "allWeightMetrics": [
                {
                    "samplePk": 1,
                    "date": 1758340000000,
                    "weight": 74350.0,      # grams
                    "bmi": 23.2,
                    "bodyFat": 16.4,
                    "bodyWater": 58.1,
                    "sourceType": "INDEX_SCALE",
                }
            ],
        },
        {
            "summaryDate": "2026-09-19",
            "allWeightMetrics": [{"weight": 74800.0, "bmi": 23.3}],
        },
    ]
}

# --- Export-ZIP shapes (different units, different names) -------------------------

EXPORT_ACTIVITY = {
    "activityId": 555000111,
    "name": "Export shape run",
    "activityType": "running",
    "beginTimestamp": 1789883931000,     # epoch ms
    "startTimeLocal": 1789894731000,     # epoch ms, local
    "duration": 3721500,                 # milliseconds
    "movingDuration": 3688000,
    "distance": 1204328.0,               # centimetres
    "elevationGain": 4100.0,             # centimetres
    "avgSpeed": 3266.0,                  # millimetres/second
    "maxSpeed": 4512.0,
    "avgHr": 152.0,
    "maxHr": 174.0,
    "calories": 812.0,
    "avgRunCadence": 173.4,
    "aerobicTrainingEffect": 3.6,
}

EXPORT_SLEEP = [
    {
        "calendarDate": "2026-09-17",
        "sleepTimeSeconds": 25800,
        "deepSleepSeconds": 4600,
        "lightSleepSeconds": 15200,
        "remSleepSeconds": 6000,
        "awakeSleepSeconds": 800,
        "sleepScores": {"overall": {"value": 74}},
    },
    {
        "calendarDate": "2026-09-16",
        "sleepTimeSeconds": 23400,
        "deepSleepSeconds": 3900,
        "lightSleepSeconds": 14100,
        "remSleepSeconds": 5400,
        "awakeSleepSeconds": 1500,
        "sleepScores": {"overall": {"value": 66}},
    },
]

EXPORT_WELLNESS = [
    {
        "calendarDate": "2026-09-17",
        "totalSteps": 9120,
        "restingHeartRate": 53,
        "totalKilocalories": 2810.0,
        "activeKilocalories": 610.0,
        "averageStressLevel": 31,
        "maxStressLevel": 79,
        "bodyBatteryHighestValue": 79,
        "bodyBatteryLowestValue": 21,
        "bodyBatteryChargedValue": 55,
        "bodyBatteryDrainedValue": 61,
        "moderateIntensityMinutes": 18,
        "vigorousIntensityMinutes": 22,
        "floorsAscended": 7.0,
    }
]

# Something we deliberately do not model, to prove it is archived rather than dropped.
EXPORT_UNKNOWN = {
    "someFutureMetricNobodyHasSeen": [{"date": "2026-09-17", "value": 42}],
}
