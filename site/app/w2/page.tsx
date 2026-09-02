"use client";
import DialogueBox from "@/components/DialogueBox";

// A placeholder so the app runs end to end from the first commit. The real yard
// arrives with the crew row, the plot card and the Inspector.
export default function Buildyard() {
  return (
    <div className="wrap">
      <div className="eyebrow">02 · DECOMPOSE</div>
      <h1 className="serif" style={{ fontWeight: 500, fontSize: 34, margin: "8px 0 18px" }}>
        The Buildyard
      </h1>
      <DialogueBox portrait="/world/npc/odo.jpg" speaker="Odo" role="the Yardmaster"
        text="Yard's not open yet. Come back when the crew arrives." />
    </div>
  );
}
