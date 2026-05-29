import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

type WelcomeEmailProps = {
  appUrl?: string;
  name?: string;
};

const defaultAppUrl = process.env.APP_URL ?? "http://localhost:3000";

export default function WelcomeEmail({
  appUrl = defaultAppUrl,
  name = "there",
}: WelcomeEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Welcome to Nexa</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Welcome to Nexa</Heading>
          <Text style={paragraph}>Hello {name},</Text>
          <Text style={paragraph}>Your Nexa workspace is ready.</Text>
          <Button href={appUrl} style={button}>
            Open Nexa
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

WelcomeEmail.PreviewProps = {
  appUrl: "http://localhost:3000",
  name: "Ada",
} satisfies WelcomeEmailProps;

const main = {
  backgroundColor: "#f6f7f9",
  color: "#18181b",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #e4e4e7",
  borderRadius: "8px",
  margin: "32px auto",
  padding: "32px",
};

const heading = {
  fontSize: "24px",
  lineHeight: "32px",
  margin: "0 0 24px",
};

const paragraph = {
  color: "#52525b",
  fontSize: "16px",
  lineHeight: "24px",
};

const button = {
  backgroundColor: "#18181b",
  borderRadius: "8px",
  boxSizing: "border-box" as const,
  color: "#ffffff",
  display: "inline-block",
  marginTop: "12px",
  padding: "12px 16px",
  textDecoration: "none",
};
