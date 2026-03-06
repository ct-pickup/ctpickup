export type CoachDetails = {
  experience: string[];
  coaching: string[];
  location: string;
};

export type TrainingCoach = {
  slug: string;
  name: string;
  photoSrc?: string;
  experienceLine?: string;
  position?: string;
  homeField?: string;
  details: CoachDetails;
};

export const TRAINING_COACHES: TrainingCoach[] = [
  {
    slug: "coach-1",
    name: "COACH 1 NAME",
    photoSrc: "/coaches/coach-1.jpeg",
    experienceLine: "Denmark (2nd), Spain (Segunda), NCAA D1",
    position: "Goalkeeper (GK)",
    homeField: "Darien, CT",
    details: {
      experience: [
        "Hvidovre IF (Denmark, 2nd Division)",
        "Levante UD (Spain, Segunda División)",
        "Training: HB Køge, Lyngby Boldklub (Denmark); Torrent CF (Spain)",
        "Colgate University, NCAA Division I",
        "USYNT Regional Camp selection",
        "Capelli Sport USA: U17, U19; U19 captain",
      ],
      coaching: [
        "Goalkeeper Coach, KeeperMax (4 years)",
        "Private training sessions",
        "Coaching this summer with GSS Goalkeeping",
      ],
      location: "Darien, CT.",
    },
  },

  { slug: "coach-2", name: "COACH 2 NAME", details: { experience: [], coaching: [], location: "" } },
  { slug: "coach-3", name: "COACH 3 NAME", details: { experience: [], coaching: [], location: "" } },
  { slug: "coach-4", name: "COACH 4 NAME", details: { experience: [], coaching: [], location: "" } },
  { slug: "coach-5", name: "COACH 5 NAME", details: { experience: [], coaching: [], location: "" } },
];
