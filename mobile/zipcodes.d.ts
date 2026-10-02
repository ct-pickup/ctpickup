declare module "zipcodes" {
  export function lookup(zip: string): { latitude: number; longitude: number; state?: string; city?: string } | undefined;
}
