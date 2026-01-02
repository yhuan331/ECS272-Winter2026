import Example from './components/Example'
import Notes from './components/Notes'
import { NotesWithReducer, CountProvider } from './components/NotesWithReducer';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { grey } from '@mui/material/colors';

// Adjust the color theme for material ui
const theme = createTheme({
  palette: {
    primary:{
      main: grey[700],
    },
    secondary:{
      main: grey[700],
    }
  },
})

// For how Grid works, refer to https://mui.com/material-ui/react-grid/

function Layout() {
  return (
    <Box id='main-container'>
      <Stack spacing={1} sx={{ height: '100%' }}>
        {/* Top row: Example component taking about 60% width */}
        <Grid container spacing={1} sx={{ height: '60%' }}>
          <Grid size={7}>
            <Example />
          </Grid>
          {/* flexible spacer to take remaining space */}
          <Grid size="grow" />
        </Grid>
        {/* Bottom row: Notes component taking full width */}
        <Grid size={12} sx={{ height: '40%' }}>
          <Notes msg={"This is a message sent from App.tsx as component prop"} />
          { /* Uncomment the following to see how state management works in React.
            <CountProvider>
              <NotesWithReducer msg={"This is a message sent from App.tsx as component prop"} />
            </CountProvider>
          */ }
        </Grid>
      </Stack>
    </Box>
  )
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <Layout />
    </ThemeProvider>
  )
}

export default App
