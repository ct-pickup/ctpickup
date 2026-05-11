declare module "zipcodes" {
  export function lookup(zip: string): { latitude: number; longitude: number; state?: string } | undefined;
}
