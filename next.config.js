/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "rzfvskewfunswzipcfii.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // or simpler:
    // domains: ["rzfvskewfunswzipcfii.supabase.co"],
  },
};

module.exports = nextConfig;
