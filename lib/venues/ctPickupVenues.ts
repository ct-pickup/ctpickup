/** Canonical CT Pickup venue list for Distance Matrix destinations (display + routing). */
export type CtPickupVenue = {
  venue: string;
  address: string;
};

export const CT_PICKUP_VENUES: readonly CtPickupVenue[] = [
  // NJ
  {
    venue: "Sofive Meadowlands",
    address: "2 Palmer Terrace, Carlstadt, NJ 07072",
  },
  {
    venue: "Sofive Cherry Hill",
    address: "650 Kresson Rd, Cherry Hill, NJ 08034",
  },
  // NY
  {
    venue: "Sofive Brooklyn",
    address: "2015 Pitkin Ave, Brooklyn, NY 11207",
  },
  {
    venue: "Hudson Sports Complex",
    address: "Warwick, NY",
  },
  {
    venue: "New Rochelle SoccerRoof",
    address: "29 LeCount Pl, New Rochelle, NY",
  },
  // MD
  {
    venue: "Sofive Rockville",
    address: "1008 Westmore Ave, Rockville, MD 20850",
  },
  {
    venue: "SoccerDome Jessup",
    address: "7330 Montevideo Road, Jessup, MD 20794",
  },
  {
    venue: "SoccerDome Harmans",
    address: "7447 Shipley Avenue, Harmans, MD 21077",
  },
  // CT
  {
    venue: "New Haven SoccerRoof",
    address: "1018 Sherman Ave, Hamden, CT",
  },
];
