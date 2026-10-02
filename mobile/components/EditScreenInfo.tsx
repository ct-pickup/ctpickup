import React from 'react';
import { StyleSheet } from 'react-native';

import { ExternalLink } from './ExternalLink';
import { MonoText } from './StyledText';
import { Text, View } from './Themed';


import { themeColor } from "@/theme";
export default function EditScreenInfo({ path }: { path: string }) {
  return (
    <View>
      <View style={styles.getStartedContainer}>
        <Text
          style={styles.getStartedText}
          lightColor={themeColor().onPitch}
          darkColor={themeColor().text}>
          Open up the code for this screen
        </Text>

        <View
          style={[styles.codeHighlightContainer, styles.homeScreenFilename]}
          darkColor={themeColor().muted}
          lightColor={themeColor().onPitch}>
          <MonoText>{path}</MonoText>
        </View>

        <Text
          style={styles.getStartedText}
          lightColor={themeColor().onPitch}
          darkColor={themeColor().text}>
          Change any of the text, save the file, and your app will automatically update.
        </Text>
      </View>

      <View style={styles.helpContainer}>
        <ExternalLink
          style={styles.helpLink}
          href="https://docs.expo.io/get-started/create-a-new-app/#opening-the-app-on-your-phonetablet">
          <Text style={styles.helpLinkText} lightColor={themeColor().pitch}>
            Tap here if your app doesn't automatically update after making changes
          </Text>
        </ExternalLink>
      </View>
    </View>
  );
}

function make_styles() {
  return StyleSheet.create({
  getStartedContainer: {
    alignItems: 'center',
    marginHorizontal: 50,
  },
  homeScreenFilename: {
    marginVertical: 8,
  },
  codeHighlightContainer: {
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  getStartedText: {
    fontSize: 16, fontFamily: "Inter_400Regular",
    lineHeight: 24,
    textAlign: 'center',
  },
  helpContainer: {
    marginTop: 16,
    marginHorizontal: 20,
    alignItems: 'center',
  },
  helpLink: {
    paddingVertical: 16,
  },
  helpLinkText: {
    textAlign: 'center',
  },
});
}
let styles = make_styles();
function publish_styles() {
  styles = make_styles();
}

