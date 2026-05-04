import {
  Button,
  Container,
  Head,
  Html,
  Preview,
  Text,
} from "@react-email/components";

type WelcomeEmailProps = {
  name?: string;
};

export default function WelcomeEmail({ name = "there" }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Nexa</Preview>
      <Container>
        <Text>Hello {name},</Text>
        <Text>Your Nexa workspace is ready.</Text>
        <Button href="https://example.com">Open Nexa</Button>
      </Container>
    </Html>
  );
}
