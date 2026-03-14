import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        steps: {
          purple: '#6B46C1',
          blue: '#3182CE',
          green: '#38A169',
        }
      }
    },
  },
  plugins: [],
}
export default config
