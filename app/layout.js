export const metadata = {
  title: 'ADVORA',
  description: 'Plataforma de atendimento jurídico com IA'
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
