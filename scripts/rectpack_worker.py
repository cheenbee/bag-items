import json
import sys

from rectpack import MaxRectsBaf, MaxRectsBssf, SkylineBl, SORT_AREA, SORT_LSIDE, newPacker


ALGORITHMS = {
    "maxrects-bssf": (MaxRectsBssf, SORT_AREA),
    "maxrects-baf": (MaxRectsBaf, SORT_LSIDE),
    "skyline": (SkylineBl, SORT_AREA),
}


def pack_group(group, algorithm_name):
    scale = 10
    gap = float(group.get("gapCm", 1))
    width = float(group["usableWidthCm"])
    pieces = group["pieces"]
    rectangles = []
    area = 0.0
    has_fixed = any(piece.get("rotationMode") != "free" for piece in pieces)
    for piece in pieces:
        pw = float(piece["widthCm"])
        ph = float(piece["lengthCm"])
        area += pw * ph * int(piece["quantity"])
        for instance in range(int(piece["quantity"])):
            rectangles.append((round((pw + gap) * scale), round((ph + gap) * scale), {
                "partId": piece["id"], "name": piece["name"], "instance": instance + 1,
                "originalWidth": pw, "originalHeight": ph,
            }))
    if not rectangles:
        return None
    max_height = sum(height for _, height, _ in rectangles) + scale
    pack_algo, sort_algo = ALGORITHMS[algorithm_name]
    packer = newPacker(pack_algo=pack_algo, sort_algo=sort_algo, rotation=not has_fixed)
    packer.add_bin(round(width * scale), max_height)
    for rw, rh, rid in rectangles:
        packer.add_rect(rw, rh, rid=rid)
    packer.pack()
    placed = []
    for _, x, y, rw, rh, rid in packer.rect_list():
        original_w = rid["originalWidth"]
        original_h = rid["originalHeight"]
        rotated = not has_fixed and abs(rw / scale - (original_h + gap)) < 0.051 and abs(original_w - original_h) > 0.01
        actual_w = original_h if rotated else original_w
        actual_h = original_w if rotated else original_h
        placed.append({
            "partId": rid["partId"], "name": rid["name"], "instance": rid["instance"],
            "x": x / scale, "y": y / scale, "width": actual_w, "height": actual_h,
            "rotated": rotated,
        })
    if len(placed) != len(rectangles):
        raise ValueError(f"{group['materialName']} 有裁片宽度超过有效幅宽，无法排料")
    used_length = max(item["y"] + item["height"] for item in placed)
    utilization = area / (width * used_length) * 100 if used_length else 0
    return {"algorithm": algorithm_name, "usedLengthCm": round(used_length, 2),
            "utilizationRate": round(utilization, 2), "pieces": placed,
            "rotationLimited": has_fixed}


def main():
    payload = json.load(sys.stdin)
    results = []
    requested = payload.get("algorithms") or list(ALGORITHMS)
    for group in payload["groups"]:
        candidates = [pack_group(group, name) for name in requested if name in ALGORITHMS]
        best = min((item for item in candidates if item), key=lambda item: item["usedLengthCm"])
        results.append({**group, **best})
    json.dump({"groups": results}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
