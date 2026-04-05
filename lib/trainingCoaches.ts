/** Headshot URL under `public/coaches/{slug}.jpg`. */
export function coachPhotoSrc(slug: string): string {
  return `/coaches/${slug}.jpg`;
}

export type TrainingCoach = {
  slug: string;
  name: string;
  hometown: string;
  /** School / program for the main training card (short). */
  college: string;
  /** Playing position for the main training card (short). */
  position: string;
  /** One-line specialty for the training grid; detail page uses `specialty`. */
  cardSpecialty: string;
  /** CSS `object-position` for inconsistent source crops (headshot bias). */
  imagePosition?: string;
  experience: string;
  coaching: string;
  specialty: string;
  bookingLink: string;
};

export const TRAINING_REQUEST_LINK =
  "https://docs.google.com/forms/d/e/1FAIpQLSeR2O1XLFZzScSQLRxu9601b2XFVfxUe8uAqNZjttfN3r0VIQ/viewform";

export const trainingCoaches: TrainingCoach[] = [
  {
    slug: "gabriel-chavez",
    name: "Gabriel Chavez",
    hometown: "Wethersfield, Connecticut",
    college: "University of Vermont",
    position: "Midfielder",
    cardSpecialty:
      "High-level technical work, academy habits, speed of play, competitive standards",
    imagePosition: "50% 12%",
    experience:
      "Played with the New England Revolution and New England Revolution II in MLS NEXT Pro. Two-time MLS NEXT Cup Champion and captain of the U19 team within the New England Revolution academy system. Competed at the NCAA Division I level at Providence College and will be entering his second year at the University of Vermont. Represented Peru at the U17 National Team level in international competition.",
    coaching:
      "Worked with youth players at camps at Providence College and the University of Vermont, assisting coaching staff with training sessions, summer camps, and player development programming.",
    specialty:
      "High-level technical work, academy habits, speed of play, and competitive training standards.",
    bookingLink: TRAINING_REQUEST_LINK,
  },
  {
    slug: "arian-recinos",
    name: "Arian Recinos",
    hometown: "Norwalk, Connecticut",
    college: "Penn State University",
    position: "Midfielder",
    cardSpecialty:
      "Game understanding, competitive training, leadership, advanced development",
    imagePosition: "50% 14%",
    experience:
      "Played with the New York Red Bulls second team in the USL Championship and MLS NEXT Pro. Competed at the NCAA Division I level at both the University of New Hampshire and Penn State University. Served as captain of the Guatemala U20 National Team and represented Guatemala in CONCACAF competition and two U20 World Cup qualifying campaigns. Was recently called up to train with the U23 National Team.",
    coaching:
      "Coached youth sessions at the University of New Hampshire, including summer camp training and fall sessions connected to ID camp programming led by UNH staff.",
    specialty:
      "High-level game understanding, competitive training, leadership, and advanced player development.",
    bookingLink: TRAINING_REQUEST_LINK,
  },
  {
    slug: "matt-mcleod",
    name: "Matt Mcleod",
    hometown: "New Haven, Connecticut",
    college: "Trinity College",
    position: "Defender",
    cardSpecialty: "Defending, positioning, recovery speed, game awareness",
    experience:
      "Played MLS NEXT with NYSC and captained CFC at the ECNL level, helping lead the club to back-to-back ECNL National Playoff appearances. Competed as a defender at Bucknell University at the NCAA Division I level and currently plays at Trinity College at the NCAA Division III level.",
    coaching:
      "Trained youth players privately during the summer through multiple individual sessions.",
    specialty:
      "Defending, positioning, recovery speed, and game awareness.",
    bookingLink: TRAINING_REQUEST_LINK,
  },
  {
    slug: "mason-christiansen",
    name: "Mason Christiansen",
    hometown: "Darien, Connecticut",
    college: "Colgate University",
    position: "Goalkeeper",
    cardSpecialty: "Goalkeeping, shot-stopping, handling, footwork",
    experience:
      "Played with Hvidovre IF in the Danish second division. Played with Levante UD in the Spanish Segunda Division, trained with HB Køge and Lyngby Boldklub in Denmark, Torrent CF in Spain, Colgate NCAA D1, USYNT Regional Camp selection, and was a Capelli Sport USA U17 and U19 selectee and captain.",
    coaching:
      "Currently coaches goalkeepers with Keepermax, the biggest goalkeeping coaching company in Connecticut, and also runs individual sessions. Will also coach this summer for GSS Goalkeeping.",
    specialty:
      "Goalkeeping, shot-stopping, handling, footwork, and goalkeeper-specific development.",
    bookingLink: TRAINING_REQUEST_LINK,
  },
  {
    slug: "leah-delaurentiis",
    name: "Leah Delaurentiis",
    hometown: "Fairfield, Connecticut",
    college: "Bucknell University",
    position: "Defender",
    cardSpecialty:
      "Defending, positioning, 1v1 defending, age-appropriate training",
    experience:
      "Played club for the CFC ECNL 2006 team from 2018 to 2024. All Conference New England ECNL First Team Player from 2021 to 2024. Played varsity soccer for Fairfield Ludlowe High School, earned All-FCIAC First Team from 2021 to 2024, and was captain for the 2024 season. Currently competes at the NCAA Division I level at Bucknell University.",
    coaching:
      "Worked for Ole Soccer as a Head and Assistant Coach, devising sessions for children ages 4-12. Coached and supervised youth athletes by developing age-appropriate training that promoted skill development, teamwork, and sportsmanship. Started a soccer clinic in 2022 and coached youth sessions in Fairfield, Connecticut, for local families.",
    specialty:
      "Defending, positioning, and 1v1 defending, with age-appropriate technical work for younger players.",
    bookingLink: TRAINING_REQUEST_LINK,
  },
  {
    slug: "patrick-odonohue",
    name: "Patrick O'Donohue",
    hometown: "",
    college: "Colgate University",
    position: "Attacking midfielder",
    cardSpecialty:
      "Attacking play, movement, creativity, technical work for younger players",
    imagePosition: "50% 15%",
    experience:
      "Played with FC Westchester at the MLS NEXT level. Currently competing in Spain with a club in Tercera RFEF in Zaragoza and will play at the NCAA Division I level at Colgate University next year. Has experience across attacking roles, including central attacking midfield, central midfield, and left wing. Also attended two U.S. Youth National Team camps at the U15 and U16 levels.",
    coaching:
      "Ran youth camps out of his backyard for 3 years, has coached at Brunswick Sports Camp and Brunswick Wrestling Camp, coached soccer camp for players ages 5-15 last summer at Colgate University, coached at the Colgate High School ID camp led by the Colgate Men's Soccer coaching staff, and has been running private soccer sessions for kids ages 7-12 for the past 4 years.",
    specialty:
      "Attacking play, movement, creativity, and technical development for younger players.",
    bookingLink: TRAINING_REQUEST_LINK,
  },
];
