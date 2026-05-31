declare module "heic-convert" {
  type ConvertArgs = {
    buffer: Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  function convert(args: ConvertArgs): Promise<Uint8Array | ArrayBuffer>;

  export = convert;
}
