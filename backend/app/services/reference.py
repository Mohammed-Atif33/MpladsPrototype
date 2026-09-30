"""Static reference data (synthetic demo geography for Pune / Maharashtra)."""

CATEGORIES = [
    "Road Development", "Water Supply", "School Building", "Community Hall", "Drainage & Sanitation",
    "Street Lighting", "Health Centre", "Bridge / Culvert",
]

DISTRICT_CENTROIDS = {
    "Pune": (18.5204, 73.8567),
    "Pimpri-Chinchwad": (18.6298, 73.7997),
    "Satara": (17.6805, 74.0183),
    "Kolhapur": (16.7050, 74.2433),
    "Nashik": (19.9975, 73.7898),
    "Ahmednagar": (19.0948, 74.7480),
    "Solapur": (17.6599, 75.9064),
    "Sangli": (16.8524, 74.5815),
}

DISTRICT_CONSTITUENCIES = {
    "Pune": ["Pune", "Baramati", "Maval", "Shirur"],
    "Pimpri-Chinchwad": ["Maval", "Shirur", "Pune"],
    "Satara": ["Satara", "Madha"],
    "Kolhapur": ["Kolhapur", "Hatkanangle"],
    "Nashik": ["Nashik", "Dindori"],
    "Ahmednagar": ["Ahmednagar", "Shirdi"],
    "Solapur": ["Solapur", "Madha"],
    "Sangli": ["Sangli", "Hatkanangle"],
}

# Approximate bounding box of Maharashtra, used only as a sanity check on coordinates.
MAHARASHTRA_BBOX = (15.6, 22.1, 72.6, 80.9)  # lat_min, lat_max, lon_min, lon_max


def canonical_district(name: str | None) -> str | None:
    if not name:
        return None
    n = name.strip().lower().replace("–", "-")
    for d in DISTRICT_CENTROIDS:
        if d.lower() == n or d.lower().replace("-", " ") == n.replace("-", " "):
            return d
    return None
