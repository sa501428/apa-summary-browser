import matplotlib
matplotlib.use('agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
import os
import json

DISTANCES = ["intra.short", "intra.long", "inter"]
STEMS = [
    "ELF3", "BHLHE40", "RXRB", "ZBTB33", "PATZ1", "MNT", "HNF4G", "SOX5", "HNF4A",
    # ... continue adding all 600+ ...
    "MAFF", "CEBPB", "FOXA1", "HLF", "MAFK"
]

REDMAP = LinearSegmentedColormap.from_list("bright_red", [(1, 1, 1), (1, 0, 0)])

def get_score(matrix, res=100):
    center_peak_width = 5 if res == 10 else 2
    r = matrix.shape[0]
    buffer = r // 4
    color_lim2 = 3 * np.mean(matrix[:buffer, -buffer:])
    rc = r // 2
    center = np.mean(matrix[rc - center_peak_width:rc + center_peak_width + 1, rc - center_peak_width:rc + center_peak_width + 1])
    ll = np.mean(matrix[-buffer:, :buffer])
    score = center / ll if ll != 0 else 0
    return score, color_lim2

RESOLUTION = 100

for dist in DISTANCES:
    print(f"Processing {dist} for APA scores...")
    score_dict = {}

    for stem1 in STEMS:
        inner_dict = {}
        for stem2 in STEMS:
            fname = f"results/{dist}/hep_{dist}_{stem1}_{stem2}.txt"
            try:
                matrix = np.loadtxt(fname)
                score, _ = get_score(matrix, RESOLUTION)
                inner_dict[stem2] = round(score, 4)  # round for readability
            except Exception as e:
                inner_dict[stem2] = None  # or use 0, "NA", etc.
        score_dict[stem1] = inner_dict

    # Save as nested JSON
    output_path = f"apa_scores_{dist}_lookup.json"
    with open(output_path, "w") as jf:
        json.dump({"scores": score_dict}, jf, indent=2)
    print(f"Saved: {output_path}")
