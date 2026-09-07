/** Lightweight brand decoration; excluded from interaction and accessibility trees. */
export function HoneyDrip({ side = false }: { side?: boolean }) {
  return side ? (
    <svg
      className="honey-drip honey-drip--side"
      viewBox="0 0 40 180"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0 0H30V24C30 36 18 36 18 49V108C18 121 8 121 8 108V72C8 63 0 65 0 75Z"
        fill="#e7a82e"
      />
      <path
        d="M0 0H25V24C25 34 13 35 13 48V107"
        stroke="#ffdc71"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M13 138C13 138 7 148 7 153A6 6 0 0 0 19 153C19 148 13 138 13 138Z" fill="#e7a82e" />
      <path d="M11 150V154" stroke="#ffe391" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ) : (
    <svg
      className="honey-drip honey-drip--top"
      viewBox="0 0 240 75"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0 0H240V8C228 8 221 13 207 13H194C184 13 181 19 181 29V52C181 70 159 70 159 52V31C159 20 145 20 145 32V38C145 51 127 51 127 38V24C127 13 119 12 111 12H85C77 12 73 17 73 25V39C73 57 51 57 51 39V24C51 13 42 11 34 11H13C7 11 3 9 0 8Z"
        fill="#e7a82e"
      />
      <path
        d="M5 4H234M57 21V38C57 44 62 47 66 43M165 29V51C165 59 172 61 175 55M133 24V37"
        stroke="#ffe18a"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
